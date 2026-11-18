import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessPullRequest, parseNumstat, validateResult } from './faa-risk-adapter.mjs';
import { createFaaEnvironment, runFaaAnalysis, selectExecution } from './faa-execution.mjs';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function sameSnapshot(current, event) {
  const expected = event.pull_request;
  const labels = (pr) => pr.labels.map((label) => label.name).sort();
  return current.state === 'open' && current.draft === false
    && current.number === expected.number && current.base?.ref === 'main'
    && current.base?.repo?.id === event.repository.id
    && current.head?.repo?.id === event.repository.id
    && current.base.sha === expected.base.sha && current.head.sha === expected.head.sha
    && current.body === expected.body
    && JSON.stringify(labels(current)) === JSON.stringify(labels(expected));
}

async function getCurrentPr(number, env) {
  requireValue(env.FAA_GITHUB_TOKEN, 'Missing read-only GitHub token for current PR verification');
  const response = await fetch(`https://api.github.com/repos/fortify-presales/IWA-Agentic/pulls/${number}`, {
    headers: {
      Authorization: `Bearer ${env.FAA_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  requireValue(response.ok, `Current PR verification failed: GitHub HTTP ${response.status}`);
  return response.json();
}

export async function runPrScan({
  controlDir, sourceDir, outputDir, event, env = process.env, execute = execFileSync,
  getPullRequest = (number) => getCurrentPr(number, env), approvedControlSha,
}) {
  const started = Date.now();
  const record = {
    mode: 'differential', scope: sourceDir, status: 'failed',
    analyzerInvoked: false, analyzerExitCode: null,
    startedAt: new Date(started).toISOString(),
  };
  await mkdir(outputDir, { recursive: true });
  const git = (directory, ...args) => execute('git', ['-C', directory, ...args], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure;
  try {
    // Only a separately reviewed main-branch launcher may supply this library-only override.
    const premerge = approvedControlSha !== undefined;
    requireValue((premerge
      ? env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main'
      : env.GITHUB_EVENT_NAME === 'pull_request_target')
      && env.GITHUB_REPOSITORY === 'fortify-presales/IWA-Agentic'
      && event?.repository?.full_name === env.GITHUB_REPOSITORY, 'Unapproved PR execution context');
    const policyText = await readFile(join(controlDir, '.github', 'faa-policy.json'), 'utf8');
    const policy = JSON.parse(policyText);
    // Validate event SHAs before using them as Git arguments.
    assessPullRequest(event, [], policy);
    const pr = event.pull_request;
    requireValue(pr.base.ref === 'main', 'Only PRs targeting main can select FAA');
    if (premerge) {
      requireValue(/^[a-f0-9]{40}$/.test(approvedControlSha)
        && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')
        && pr.number === 26 && pr.head.sha === approvedControlSha
        && pr.head.repo?.id === event.repository.id,
      'Pre-merge validation requires PR 26 at its explicitly approved control/head SHA');
    }
    const expectedControlSha = premerge ? approvedControlSha : pr.base.sha;
    for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
      requireValue(/^[1-9][0-9]*$/.test(env[key] ?? ''), `Missing/invalid ${key}`);
    }
    Object.assign(record, {
      repository: event.repository.full_name, repositoryId: event.repository.id, pullRequest: pr.number,
      baseSha: pr.base.sha, headSha: pr.head.sha, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
      assessmentId: `${event.repository.id}:${pr.number}:${pr.head.sha}:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`,
      buildId: `github-pr-${event.repository.id}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
      executionContext: premerge ? 'premerge-validation' : 'pull-request',
      triggerEvent: env.GITHUB_EVENT_NAME,
      ...(premerge ? { launcherSha: env.GITHUB_SHA } : {}),
    });
    const controls = await realpath(controlDir);
    const source = await realpath(sourceDir);
    requireValue(!isWithin(controls, source) && !isWithin(source, controls),
      'Controls and PR source must be separate, non-nested checkouts');
    requireValue(!isWithin(source, await realpath(outputDir)), 'Scan outputs must be outside PR source');
    record.controlSha = git(controlDir, 'rev-parse', 'HEAD').trim();
    requireValue(record.controlSha === expectedControlSha && env.FAA_TRUSTED_CONTROL_SHA === expectedControlSha,
      'Control checkout does not match the immutable approved revision (PR base in normal execution)');
    requireValue(!git(controlDir, 'status', '--porcelain', '--untracked-files=normal', '--ignored').trim(),
      'Trusted control checkout must be clean');
    requireValue(git(sourceDir, 'rev-parse', 'HEAD').trim() === pr.head.sha,
      'Source checkout does not match the assessed PR head');
    requireValue(!git(sourceDir, 'status', '--porcelain', '--untracked-files=normal', '--ignored').trim(),
      'PR source checkout must be clean');
    const entries = git(sourceDir, 'ls-files', '--stage', '-z').split('\0').filter(Boolean);
    requireValue(entries.every((entry) => /^(100644|100755) [a-f0-9]{40} 0\t/.test(entry)),
      'PR scan input must contain only regular files; symlinks and submodules are not scanned');
    record.diffBaseSha = git(sourceDir, 'merge-base', pr.base.sha, pr.head.sha).trim();
    const changes = parseNumstat(git(sourceDir, '-c', 'core.quotepath=false', 'diff',
      '--no-ext-diff', '--no-textconv', '--find-renames', '--numstat', '-z',
      record.diffBaseSha, pr.head.sha, '--'));
    const result = validateResult(assessPullRequest(event, changes, policy, {
      assessedAt: record.startedAt, controlSha: record.controlSha, diffBaseSha: record.diffBaseSha,
      assessmentId: record.assessmentId, executionContext: record.executionContext,
      policySha256: createHash('sha256').update(policyText).digest('hex'),
    }));
    record.score = result.score;
    record.decision = result.decision;
    record.status = selectExecution(result, event, env.FAA_PR_SCANS_ENABLED);
    result.faaExecution.status = record.status;
    await writeFile(join(outputDir, 'faa-risk-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    if (record.status === 'pending-execution') {
      if (!sameSnapshot(await getPullRequest(pr.number), event)) {
        record.status = 'skipped-stale';
      } else {
        record.range = `${record.diffBaseSha}..${pr.head.sha}`;
        const changed = git(sourceDir, 'diff', '--no-ext-diff', '--no-textconv',
          '--name-only', '-z', '--diff-filter=ACMRT', record.range, '--');
        record.changedFileCount = changed.split('\0').filter(Boolean).length;
        if (!record.changedFileCount) {
          record.status = 'skipped-no-changes';
        } else {
          const analyzerEnv = createFaaEnvironment(env);
          record.licensePlatform = env.FAA_LICENSE_PLATFORM;
          await runFaaAnalysis({
            sourceDir, outputDir, range: record.range, scope: sourceDir, buildId: record.buildId,
            record, env: analyzerEnv, cwd: controlDir, execute,
          });
          requireValue(git(sourceDir, 'rev-parse', 'HEAD').trim() === pr.head.sha
            && !git(sourceDir, 'status', '--porcelain', '--untracked-files=normal', '--ignored').trim(),
          'PR source changed during analysis; results cannot attest the assessed revision');
          record.status = sameSnapshot(await getPullRequest(pr.number), event) ? 'succeeded' : 'stale';
        }
      }
    }
  } catch (error) {
    failure = error;
    record.status = 'failed';
    record.error = error.message;
    if (record.analyzerInvoked && record.analyzerExitCode === null && Number.isInteger(error.status)) {
      record.analyzerExitCode = error.status;
    }
  }
  record.finishedAt = new Date().toISOString();
  record.durationMs = Date.now() - started;
  await writeFile(join(outputDir, 'faa-pr-execution.json'), `${JSON.stringify(record, null, 2)}\n`);
  const summary = [
    '## FAA PR execution (audit only)', '',
    `Status: **${record.status}**`,
    `Execution context: **${record.executionContext ?? 'not validated'}**`,
    `Risk score: ${record.score ?? 'not assessed'} | Decision: **${record.decision ?? 'not assessed'}**`,
    `Head: \`${record.headSha ?? 'not validated'}\``,
    `Control revision: \`${record.controlSha ?? 'not validated'}\``,
    `Range: \`${record.range ?? 'not selected'}\``,
    `Analyzer invoked: **${record.analyzerInvoked ? 'yes' : 'no'}**`,
    `Findings: ${record.findingCount ?? 'not available'}`,
    `Duration: ${record.durationMs} ms`, '',
    'Source-checkout scripts were not installed, built or executed by this workflow. No FoD/SSC import or release gate.',
    ...(failure ? ['', 'Execution failed; inspect the job log and execution record.'] : []), '',
  ].join('\n');
  await writeFile(join(outputDir, 'faa-pr-execution-summary.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  if (failure) throw failure;
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.env.FAA_SOURCE_DIR && process.env.FAA_OUTPUT_DIR && process.env.GITHUB_EVENT_PATH,
      'Missing trusted PR scan configuration');
    await runPrScan({
      controlDir: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
      sourceDir: resolve(process.env.FAA_SOURCE_DIR), outputDir: resolve(process.env.FAA_OUTPUT_DIR),
      event: JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')),
    });
  } catch (error) {
    console.error(`FAA PR scan failed: ${JSON.stringify(error.message)}`);
    process.exitCode = 1;
  }
}
