/*
 * FAA risk adapter: decides whether a pull request should run a differential
 * Fortify Agentic Analyzer (FAA) scan. Dependency-free; needs Node 20+ and Git.
 *
 * HOW IT WORKS
 *   1. Reads the GitHub pull_request event (labels, body) and the policy JSON.
 *   2. Lists changed files/lines between merge-base(base, head) and head.
 *   3. Adds the points of every matching policy rule. FAA is selected when
 *      score >= threshold, the PR changes (not only deletes) files, and the PR
 *      is not from a fork.
 *
 * OUTPUTS
 *   GITHUB_OUTPUT  score, do_faa (true|false), change_range (<merge-base>..<head>)
 *   --output dir   faa-risk-result.json and faa-risk-summary.md
 *   Step summary   the same Markdown, when GITHUB_STEP_SUMMARY is set
 *
 * USE IN ANOTHER REPOSITORY
 *   Copy this script and faa-policy.json, then gate the FAA job on do_faa:
 *     - uses: actions/checkout@v4
 *       with: { ref: ${{ github.event.pull_request.head.sha }}, fetch-depth: 0 }
 *     - id: risk
 *       run: node .github/scripts/faa-risk-adapter.mjs --source . --policy .github/faa-policy.json --output "$RUNNER_TEMP/faa-risk"
 *   then:  if: needs.<job>.outputs.do_faa == 'true'
 *   and pass change_range to FAA as --differential.
 *
 * CUSTOMIZING
 *   Edit the policy, not this script. Rule types (see _instructions in the policy):
 *     label | paths | declaration | minChangedLines
 *   To add a new rule type, add one case to ruleEvidence() returning the
 *   evidence strings that matched (an empty array means no match), and allow its
 *   key in conditionKeys.
 *
 * LOCAL TEST
 *   gh api repos/<owner>/<repo>/pulls/<n> --jq '{pull_request: .}' > event.json
 *   node faa-risk-adapter.mjs --event event.json --source <checkout-at-head> --output out
 */
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const usage = 'Usage: node faa-risk-adapter.mjs --source <checkout-at-pr-head> --output <dir> [--policy <policy.json>] [--event <event.json>]';
const conditionKeys = ['label', 'paths', 'declaration', 'minChangedLines'];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function validatePolicy(policy) {
  check(Number.isSafeInteger(policy?.threshold) && policy.threshold > 0, 'Policy threshold must be a positive integer');
  check(Array.isArray(policy.rules) && policy.rules.length > 0, 'Policy rules must be a non-empty array');
  for (const rule of policy.rules) {
    check(typeof rule?.name === 'string' && rule.name, 'Every rule needs a name');
    check(Number.isSafeInteger(rule.points) && rule.points >= 0, `Rule "${rule.name}": points must be a non-negative integer`);
    const conditions = conditionKeys.filter((key) => key in rule);
    check(conditions.length === 1, `Rule "${rule.name}": needs exactly one of ${conditionKeys.join(', ')}`);
    if (rule.paths) {
      check(Array.isArray(rule.paths) && rule.paths.length, `Rule "${rule.name}": paths must be a non-empty array`);
      rule.paths.forEach((pattern) => new RegExp(pattern, 'i'));
    }
    if (rule.declaration) {
      check(typeof rule.declaration.field === 'string' && Array.isArray(rule.declaration.values),
        `Rule "${rule.name}": declaration needs field and values`);
    }
    if ('minChangedLines' in rule) {
      check(Number.isSafeInteger(rule.minChangedLines) && rule.minChangedLines > 0, `Rule "${rule.name}": invalid minChangedLines`);
    }
  }
  return policy;
}

// Reads '- <field>: <value>' lines from the PR body, ignoring HTML comments.
export function parseDeclarations(body) {
  const values = {};
  for (const line of (body ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const match = /^\s*-\s*([^:]+):\s*(.*)$/.exec(line);
    if (match && match[2].trim()) values[match[1].trim().toLowerCase()] = match[2].trim().toLowerCase();
  }
  return values;
}

function ruleEvidence(rule, pr) {
  if (rule.label) return pr.labels.includes(rule.label) ? [`label:${rule.label}`] : [];
  if (rule.paths) return pr.paths.filter((path) => rule.paths.some((p) => new RegExp(p, 'i').test(path)));
  if (rule.declaration) {
    const field = rule.declaration.field.toLowerCase();
    const value = pr.declarations[field];
    return rule.declaration.values.map((v) => v.toLowerCase()).includes(value) ? [`${rule.declaration.field}: ${value}`] : [];
  }
  return pr.changedLines >= rule.minChangedLines ? [`${pr.changedLines} changed lines`] : [];
}

// pr: { labels: string[], body: string, paths: string[], changedLines: number }
export function assess(policy, pr) {
  validatePolicy(policy);
  const input = { ...pr, declarations: parseDeclarations(pr.body) };
  const matched = policy.rules
    .map((rule) => ({ name: rule.name, points: rule.points, evidence: ruleEvidence(rule, input) }))
    .filter((rule) => rule.evidence.length);
  const score = matched.reduce((total, rule) => total + rule.points, 0);
  return { score, threshold: policy.threshold, selected: score >= policy.threshold, matched };
}

export function formatSummary(result) {
  const escape = (value) => String(value).replace(/[&<>|`\\\r\n[\]()]/g, (c) => `&#${c.charCodeAt(0)};`);
  return [
    '## FAA risk assessment', '',
    `Score **${result.score}** / threshold **${result.threshold}** - run FAA: **${result.doFaa}**`, '',
    '| Rule | Points | Evidence |', '| --- | ---: | --- |',
    ...result.matched.map((r) => `| ${escape(r.name)} | ${r.points} | ${r.evidence.slice(0, 10).map(escape).join(', ')}${r.evidence.length > 10 ? ', ...' : ''} |`),
    '', `Change range: \`${result.changeRange}\``, '',
  ].join('\n');
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 }).toString();
}

export async function runAdapter({ eventPath, sourceDir, outputDir, policyPath, env = process.env }) {
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const policy = validatePolicy(JSON.parse(await readFile(policyPath, 'utf8')));
  const pr = event.pull_request;
  check(pr && /^[a-f0-9]{40}$/.test(pr.base?.sha) && /^[a-f0-9]{40}$/.test(pr.head?.sha)
    && Number.isSafeInteger(pr.base.repo?.id), 'Event is not a pull_request with base/head SHAs and base repository');
  check(git(sourceDir, ['rev-parse', 'HEAD']).trim() === pr.head.sha, 'Source checkout does not match PR head');

  const mergeBase = git(sourceDir, ['merge-base', pr.base.sha, pr.head.sha]).trim();
  const numstat = git(sourceDir, ['diff', '--numstat', '-z', '--no-renames', mergeBase, pr.head.sha]);
  const files = numstat.split('\0').filter(Boolean).map((record) => record.split('\t'));
  const changedLines = files.reduce((total, [added, deleted]) => total + (Number(added) || 0) + (Number(deleted) || 0), 0);
  const hasNonDeletions = git(sourceDir, ['diff', '--name-only', '--diff-filter=d', mergeBase, pr.head.sha]).trim() !== '';
  const sameRepo = pr.head.repo?.id === pr.base.repo?.id;

  const result = assess(policy, {
    labels: (pr.labels ?? []).map((label) => label.name),
    body: pr.body,
    paths: files.map(([, , path]) => path),
    changedLines,
  });
  result.doFaa = result.selected && hasNonDeletions && sameRepo;
  result.skipReason = !result.selected ? 'below-threshold' : !sameRepo ? 'fork' : !hasNonDeletions ? 'no-changes' : null;
  result.changeRange = `${mergeBase}..${pr.head.sha}`;
  result.pullRequest = pr.number;

  const summary = formatSummary(result);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'faa-risk-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(outputDir, 'faa-risk-summary.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `score=${result.score}\ndo_faa=${result.doFaa}\nchange_range=${result.changeRange}\n`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      event: { type: 'string' }, source: { type: 'string' }, output: { type: 'string' },
      policy: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) {
      console.log(usage);
    } else {
      const eventPath = values.event ?? process.env.GITHUB_EVENT_PATH;
      check(eventPath && values.source && values.output, usage);
      const result = await runAdapter({
        eventPath, sourceDir: resolve(values.source), outputDir: resolve(values.output),
        policyPath: resolve(values.policy ?? fileURLToPath(new URL('../faa-policy.json', import.meta.url))),
      });
      console.log(`FAA risk: score=${result.score}, threshold=${result.threshold}, do_faa=${result.doFaa}`);
    }
  } catch (error) {
    console.error(`FAA risk assessment failed: ${error.message}`);
    process.exitCode = 1;
  }
}
