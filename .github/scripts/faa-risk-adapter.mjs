import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, TextDecoder } from 'node:util';

const policyPath = fileURLToPath(new URL('../faa-policy.json', import.meta.url));
const declarations = {
  ai: ['AI assistance used', ['none', 'low', 'significant', 'predominant']],
  reviewed: ['AI-generated code manually reviewed', ['yes', 'no', 'not-applicable']],
  business: ['Security-sensitive code generated or modified', ['yes', 'no']],
  auth: ['Authentication or authorization changed', ['yes', 'no']],
  secrets: ['Secrets, tokens, credentials, or vault access changed', ['yes', 'no']],
  api: ['New or materially changed API', ['yes', 'no']],
  integration: ['New integration or trust boundary', ['yes', 'no']],
  dependency: ['New dependency introduced', ['yes', 'no']],
  internet: ['Internet-facing behaviour changed', ['yes', 'no']],
  data: ['Sensitive data processing changed', ['yes', 'no']],
  incident: ['Previous security incident area changed', ['yes', 'no']],
};
const pathSignals = {
  'authentication-authorization': ['auth', 'Authentication or authorization changed'],
  'secrets-vault': ['secrets', 'Secrets or credential handling changed'],
  'new-api': ['api', 'API changed (path or declaration proxy; not a semantic diff)'],
  'external-integration': ['integration', 'Integration or trust boundary changed'],
  'sensitive-business-logic': ['business', 'Security-sensitive business logic changed'],
  'previous-incident-area': ['incident', 'Previous incident area changed'],
};
const scoreNames = [
  'tier-1', 'internet-facing', 'restricted-data', 'confidential-data',
  ...Object.keys(pathSignals), 'predominant-ai', 'significant-ai', 'unreviewed-ai',
  'large-change', 'new-dependency',
];
const mandatorySignals = new Set([
  'authentication-authorization', 'secrets-vault', 'previous-incident-area',
]);
const notEvaluated = [
  'live-fod-ssc-metadata', 'faa-baseline-age', 'finding-suppressions',
  'repository-topics', 'release-tags', 'semantic-api-and-dependency-diffs',
];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function matches(path, patterns) {
  return patterns.some((pattern) => new RegExp(pattern, 'i').test(path));
}

export function validatePolicy(policy) {
  requireValue(policy?.version === 'pilot-1' && policy.mode === 'audit', 'Unsupported pilot policy version or mode');
  requireValue(typeof policy.repository === 'string' && /^[\w.-]+\/[\w.-]+$/.test(policy.repository), 'Invalid policy repository');
  const app = policy.application;
  requireValue(['tier-1', 'tier-2', 'tier-3'].includes(app?.tier), 'Invalid application tier');
  requireValue(typeof app.internetFacing === 'boolean', 'Missing/invalid internetFacing metadata');
  requireValue(['public', 'internal', 'confidential', 'restricted'].includes(app.dataClassification), 'Invalid data classification');
  requireValue(['pilot-assumption', 'approved'].includes(app.classificationStatus), 'Missing classification status');
  requireValue(positiveInteger(policy.thresholds?.recommended)
    && positiveInteger(policy.thresholds?.mandatory)
    && policy.thresholds.mandatory > policy.thresholds.recommended, 'Invalid risk thresholds');
  requireValue(positiveInteger(policy.changeSize?.highRisk)
    && positiveInteger(policy.changeSize?.general)
    && policy.changeSize.general >= policy.changeSize.highRisk, 'Invalid change-size thresholds');
  requireValue(policy.scores && Object.keys(policy.scores).length === scoreNames.length, 'Invalid score definitions');
  for (const name of scoreNames) {
    requireValue(Number.isSafeInteger(policy.scores[name]) && policy.scores[name] >= 0
      && policy.scores[name] <= 100, `Missing/invalid score: ${name}`);
  }
  requireValue(policy.paths && Object.keys(policy.paths).length === Object.keys(pathSignals).length, 'Invalid path signal definitions');
  for (const [name, patterns] of [
    ...Object.keys(pathSignals).map((name) => [name, policy.paths[name]]),
    ['dependencyPatterns', policy.dependencyPatterns], ['nonExecutablePatterns', policy.nonExecutablePatterns],
  ]) {
    requireValue(Array.isArray(patterns) && patterns.every((p) => typeof p === 'string' && p.length > 0), `Invalid patterns: ${name}`);
    for (const pattern of patterns) new RegExp(pattern, 'i');
  }
  return policy;
}

export function parseDeclarations(body) {
  requireValue(body === null || typeof body === 'string', 'Invalid PR body');
  const lines = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const values = {};
  const issues = [];
  for (const [key, [field, allowed]] of Object.entries(declarations)) {
    const prefix = `- ${field.toLowerCase()}:`;
    const entries = lines.map((line) => line.trim()).filter((line) => line.toLowerCase().startsWith(prefix));
    requireValue(entries.length <= 1, `Duplicate PR declaration: ${field}`);
    const value = entries[0]?.slice(prefix.length).trim().toLowerCase();
    values[key] = allowed.includes(value) ? value : 'unknown';
    if (values[key] === 'unknown') issues.push({ field, status: value ? 'unrecognized' : 'unanswered', value: value ?? null });
  }
  return { values, issues };
}

export function parseNumstat(buffer) {
  const text = typeof buffer === 'string' ? buffer : new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (!text) return [];
  requireValue(text.endsWith('\0'), 'Truncated Git numstat output');
  const records = text.slice(0, -1).split('\0');
  const changes = [];
  for (let i = 0; i < records.length; i++) {
    const match = /^([0-9]+|-)\t([0-9]+|-)\t([\s\S]*)$/.exec(records[i]);
    requireValue(match, 'Malformed Git numstat record');
    const [, added, deleted, path] = match;
    const paths = path ? [path] : [records[++i], records[++i]];
    requireValue(paths.every((p) => typeof p === 'string' && p.length > 0), 'Missing renamed Git path');
    const binary = added === '-' && deleted === '-';
    requireValue(binary || (added !== '-' && deleted !== '-'), 'Invalid binary line counts');
    const change = { paths, added: binary ? 0 : Number(added), deleted: binary ? 0 : Number(deleted), binary };
    requireValue(Number.isSafeInteger(change.added) && Number.isSafeInteger(change.deleted), 'Git line count exceeds safe integer range');
    changes.push(change);
  }
  return changes;
}

export function assessPullRequest(event, changes, policy, context = {}) {
  validatePolicy(policy);
  const pr = event?.pull_request;
  requireValue(positiveInteger(event?.repository?.id) && event.repository.full_name === policy.repository, 'Missing/mismatched repository identity');
  requireValue(positiveInteger(pr?.number) && pr.base?.repo?.id === event.repository.id, 'Invalid PR identity');
  requireValue(/^[a-f0-9]{40}$/.test(pr.base.sha) && /^[a-f0-9]{40}$/.test(pr.head?.sha), 'Invalid base/head SHA');
  requireValue(pr.draft === false, 'Draft PRs are not assessed');
  requireValue(Array.isArray(pr.labels) && pr.labels.every((label) => typeof label?.name === 'string'), 'Invalid PR labels');
  const declaration = parseDeclarations(pr.body);
  const declared = (key) => declaration.values[key] === 'yes' ? [`declaration:${declarations[key][0]}`] : [];
  const paths = [...new Set(changes.flatMap((change) => change.paths))];
  const reasons = [];
  const conflicts = [];
  const add = (signal, reason, evidence, mandatory = false) => {
    if (evidence.length) reasons.push({
      signal, reason, points: signal === 'faa-required' ? 0 : policy.scores[signal], mandatory, evidence,
    });
  };
  const app = policy.application;
  if (app.tier === 'tier-1') add('tier-1', 'Tier 1 application', ['policy:application.tier']);
  const exposure = [...(app.internetFacing ? ['policy:application.internetFacing'] : []), ...declared('internet')];
  add('internet-facing', 'Internet-facing application or declared exposure change', exposure);
  if (['restricted', 'confidential'].includes(app.dataClassification)) {
    add(`${app.dataClassification}-data`, `${app.dataClassification} data handling`, ['policy:application.dataClassification']);
  }
  const sensitivePaths = new Set();
  let declaredSensitive = false;
  for (const [signal, [field, reason]] of Object.entries(pathSignals)) {
    const supportingPaths = paths.filter((path) => matches(path, policy.paths[signal]));
    const evidence = [...supportingPaths, ...declared(field)];
    if (supportingPaths.length && declaration.values[field] === 'no') {
      conflicts.push({ field: declarations[field][0], declared: 'no', supportingPaths });
    }
    for (const path of supportingPaths) sensitivePaths.add(path);
    if (declared(field).length) declaredSensitive = true;
    add(signal, reason, evidence, mandatorySignals.has(signal) || (signal === 'new-api' && exposure.length > 0));
  }
  if (declaration.values.ai === 'predominant') add('predominant-ai', 'Predominantly AI-assisted change', ['declaration:AI assistance used']);
  if (declaration.values.ai === 'significant') add('significant-ai', 'Significantly AI-assisted change', ['declaration:AI assistance used']);
  if (declaration.values.reviewed === 'no' && declaration.values.ai !== 'none') {
    add('unreviewed-ai', 'AI-generated code declared not manually reviewed', ['declaration:AI-generated code manually reviewed']);
  }
  const executableChanges = changes.filter((change) => change.paths.some((path) => !matches(path, policy.nonExecutablePatterns)));
  const changedLines = executableChanges.reduce((total, change) => total + change.added + change.deleted, 0);
  requireValue(Number.isSafeInteger(changedLines), 'Changed-line total exceeds safe integer range');
  const highRiskChangedLines = declaredSensitive ? changedLines : executableChanges
    .filter((change) => change.paths.some((path) => sensitivePaths.has(path)))
    .reduce((total, change) => total + change.added + change.deleted, 0);
  if (changedLines >= policy.changeSize.general || highRiskChangedLines >= policy.changeSize.highRisk) {
    add('large-change', 'Executable change meets general or high-risk line threshold', [
      `changedLines:${changedLines}/${policy.changeSize.general}`,
      `highRiskChangedLines:${highRiskChangedLines}/${policy.changeSize.highRisk}`,
    ]);
  }
  add('new-dependency', 'Dependency manifest/lock file or declaration changed', [
    ...paths.filter((path) => matches(path, policy.dependencyPatterns)), ...declared('dependency'),
  ]);
  if (pr.labels.some((label) => label.name === 'faa-required')) {
    add('faa-required', 'FAA explicitly required by PR label', ['label:faa-required'], true);
  }
  const score = Math.max(0, reasons.reduce((total, reason) => total + reason.points, 0));
  const mandatory = reasons.some((reason) => reason.mandatory) || score >= policy.thresholds.mandatory;
  const decision = mandatory ? 'faa-mandatory' : score >= policy.thresholds.recommended ? 'faa-recommended' : 'sast-sca-only';
  return {
    policyVersion: policy.version, mode: policy.mode, repository: policy.repository,
    repositoryId: event.repository.id, pullRequest: pr.number, baseSha: pr.base.sha, headSha: pr.head.sha,
    ...context, score, mandatory, decision, changedLines, highRiskChangedLines, thresholds: policy.thresholds, reasons,
    application: app,
    metadataProvenance: Object.keys(app).map((field) => ({
      field, value: app[field], source: 'trusted-policy', sourceObject: context.policySha256 ?? policy.version,
      sourceField: `application.${field}`, retrievedAt: context.assessedAt ?? null,
    })),
    declarations: declaration.values, declarationIssues: declaration.issues, conflicts,
    notEvaluated,
    faaExecution: { status: decision === 'sast-sca-only' ? 'not-selected' : 'pending-runner-setup' },
  };
}

export function validateResult(result) {
  requireValue(Number.isSafeInteger(result.score) && result.score >= 0 && typeof result.mandatory === 'boolean', 'Invalid score/mandatory output');
  requireValue(['sast-sca-only', 'faa-recommended', 'faa-mandatory'].includes(result.decision), 'Invalid decision output');
  requireValue(result.mandatory === (result.decision === 'faa-mandatory'), 'Inconsistent mandatory output');
  return result;
}

export function formatSummary(result) {
  const escape = (value) => String(value).replace(/[&<>|`\\\r\n[\]()]/g, (char) => `&#${char.charCodeAt(0)};`);
  return [
    '## FAA risk assessment (audit only)', '',
    `Score: **${result.score}** | Decision: **${result.decision}** | Executable lines: **${result.changedLines}**`, '',
    `Head: \`${result.headSha}\``, '',
    '| Signal | Points | Mandatory | Evidence |', '| --- | ---: | --- | --- |',
    ...result.reasons.map((r) => `| ${escape(r.reason)} | ${r.points} | ${r.mandatory ? 'Yes' : 'No'} | ${r.evidence.slice(0, 20).map(escape).join(', ')}${r.evidence.length > 20 ? ' (more in JSON)' : ''} |`),
    '', `FAA execution: **${result.faaExecution.status}**. No FAA scan or FoD import was performed.`,
    `Application classification: **${escape(result.application.classificationStatus)}**. This is not a production release gate.`,
    `Unanswered/unrecognized declarations: ${result.declarationIssues.length}; declaration/path conflicts: ${result.conflicts.length}.`,
    `Not evaluated: ${result.notEvaluated.map(escape).join(', ')}.`, '',
  ].join('\n');
}

function git(sourceDir, args) {
  return execFileSync('git', ['-C', sourceDir, ...args], {
    timeout: 120_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function runAdapter({ eventPath, sourceDir, outputDir, env = process.env }) {
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const policyText = await readFile(policyPath, 'utf8');
  const policy = validatePolicy(JSON.parse(policyText));
  // Validate event data before using its SHAs as Git arguments.
  assessPullRequest(event, [], policy);
  const pr = event.pull_request;
  requireValue(git(sourceDir, ['rev-parse', 'HEAD']).toString().trim() === pr.head.sha, 'Source checkout does not match PR head');
  const diffBaseSha = git(sourceDir, ['merge-base', pr.base.sha, pr.head.sha]).toString().trim();
  const changes = parseNumstat(git(sourceDir, [
    '-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-textconv',
    '--find-renames', '--numstat', '-z', diffBaseSha, pr.head.sha, '--',
  ]));
  const controlSha = git(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), ['rev-parse', 'HEAD']).toString().trim();
  if (env.FAA_TRUSTED_CONTROL_SHA) {
    requireValue(controlSha === env.FAA_TRUSTED_CONTROL_SHA && controlSha === pr.base.sha, 'Control checkout does not match trusted PR base');
  }
  const assessedAt = new Date().toISOString();
  const result = validateResult(assessPullRequest(event, changes, policy, {
    assessedAt, diffBaseSha, controlSha,
    policySha256: createHash('sha256').update(policyText).digest('hex'),
    assessmentId: `${event.repository.id}:${pr.number}:${pr.head.sha}:${env.GITHUB_RUN_ID ?? 'local'}:${env.GITHUB_RUN_ATTEMPT ?? '1'}`,
  }));
  const summary = formatSummary(result);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'faa-risk-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(outputDir, 'faa-risk-summary.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `score=${result.score}\nmandatory=${result.mandatory}\ndecision=${result.decision}\n`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { event: { type: 'string' }, source: { type: 'string' }, output: { type: 'string' } },
    });
    const eventPath = values.event ?? process.env.GITHUB_EVENT_PATH;
    requireValue(eventPath && values.source && values.output, 'Usage: node faa-risk-adapter.mjs --event <event.json> --source <head-checkout> --output <directory>');
    const result = await runAdapter({ eventPath, sourceDir: resolve(values.source), outputDir: resolve(values.output) });
    console.log(`FAA risk: score=${result.score}, mandatory=${result.mandatory}, decision=${result.decision}`);
  } catch (error) {
    console.error(`FAA assessment failed: ${JSON.stringify(error.message)}`);
    process.exitCode = 1;
  }
}
