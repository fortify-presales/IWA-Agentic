import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runSmokeTest({ sourceDir, outputDir, env = process.env, execute = execFileSync }) {
  const started = Date.now();
  const record = {
    mode: 'differential', scope: 'packages', status: 'failed',
    repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    startedAt: new Date(started).toISOString(), analyzerInvoked: false, analyzerExitCode: null,
  };
  await mkdir(outputDir, { recursive: true });
  const git = (...args) => execute('git', ['-C', sourceDir, ...args], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure;
  try {
    requireValue(env.GITHUB_REPOSITORY === 'fortify-presales/IWA-Agentic'
      && ['refs/heads/main', 'refs/heads/feature/020-faa-risk-pilot'].includes(env.GITHUB_REF),
    'Only main or feature/020-faa-risk-pilot dispatches in fortify-presales/IWA-Agentic are allowed');
    requireValue(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ''), 'Invalid dispatched commit SHA');
    for (const key of ['GITHUB_REPOSITORY_ID', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
      requireValue(/^[1-9][0-9]*$/.test(env[key] ?? ''), `Missing/invalid ${key}`);
    }
    const headSha = env.GITHUB_SHA;
    requireValue(git('rev-parse', 'HEAD').trim() === headSha, 'Checkout does not match the dispatched commit');
    const suppliedBase = env.FAA_BASE_SHA?.trim();
    const baseInput = suppliedBase || git('rev-parse', `${headSha}^1`).trim();
    requireValue(/^[a-f0-9]{40}$/i.test(baseInput), 'Base must be a full 40-character commit SHA, not a revision expression');
    const baseSha = baseInput.toLowerCase();
    requireValue(baseSha !== headSha, 'Base and head must differ');
    git('merge-base', '--is-ancestor', baseSha, headSha);
    requireValue(git('status', '--porcelain', '--untracked-files=normal', '--', 'packages').trim() === '',
      'Package checkout must be clean before FAA runs');
    const range = `${baseSha}..${headSha}`;
    const changed = git('-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-textconv',
      '--name-only', '-z', '--diff-filter=ACMRT', range, '--', 'packages');
    requireValue(changed.length > 0, 'No scannable package changes in this range; choose an earlier base SHA');
    Object.assign(record, {
      baseSha, headSha, range,
      changedFileCount: changed.split('\0').filter(Boolean).length,
      buildId: `github-${env.GITHUB_REPOSITORY_ID}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    });
    const help = execute('fortifyaa', ['-help'], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    requireValue(/\b26\.4\.0\b/.test(help), 'This smoke test requires FAA 26.4.0 on PATH');
    record.analyzerVersion = '26.4.0';
    record.analyzerInvoked = true;
    execute('fortifyaa', [
      '-scan', sourceDir, '--scope', 'packages', '--differential', range,
      '--output', join(outputDir, 'faa.sarif'), '--output-format', 'sarif,md-summary',
      '--output-md-summary', join(outputDir, 'faa-summary.md'), '--message-format', 'plain',
      '-b', record.buildId,
    ], { cwd: sourceDir, stdio: 'inherit' });
    record.analyzerExitCode = 0;
    const sarif = JSON.parse(await readFile(join(outputDir, 'faa.sarif'), 'utf8'));
    requireValue(sarif?.version === '2.1.0' && Array.isArray(sarif.runs) && sarif.runs.length > 0, 'FAA did not produce a valid SARIF run');
    requireValue(sarif.runs.every((run) => run && (run.results === undefined || Array.isArray(run.results))), 'Invalid SARIF results');
    record.findingCount = sarif.runs.reduce((count, run) => count + (run.results?.length ?? 0), 0);
    requireValue((await readFile(join(outputDir, 'faa-summary.md'), 'utf8')).trim().length > 0, 'FAA Markdown summary is missing or empty');
    record.status = 'succeeded';
  } catch (error) {
    failure = error;
    record.error = error.message;
    if (record.analyzerInvoked && record.analyzerExitCode === null && Number.isInteger(error.status)) {
      record.analyzerExitCode = error.status;
    }
  }
  record.finishedAt = new Date().toISOString();
  record.durationMs = Date.now() - started;
  await writeFile(join(outputDir, 'faa-execution.json'), `${JSON.stringify(record, null, 2)}\n`);
  const summary = [
    '## FAA differential smoke test', '',
    `Status: **${record.status}**`,
    `FAA scan invoked: **${record.analyzerInvoked ? 'yes' : 'no'}**`,
    `Range: \`${record.range ?? 'not resolved'}\``,
    `Duration: ${record.durationMs} ms`,
    '', 'FAA-only run: no FoD import, baseline update, application build, or release gate.',
    ...(failure ? ['', 'The smoke test failed. See the job log and execution record.'] : []), '',
  ].join('\n');
  await writeFile(join(outputDir, 'faa-execution-summary.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  if (failure) throw failure;
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.env.GITHUB_WORKSPACE && process.env.FAA_OUTPUT_DIR, 'Missing workflow checkout/output configuration');
    await runSmokeTest({
      sourceDir: resolve(process.env.GITHUB_WORKSPACE), outputDir: resolve(process.env.FAA_OUTPUT_DIR),
    });
  } catch (error) {
    console.error(`FAA smoke test failed: ${JSON.stringify(error.message)}`);
    process.exitCode = Number.isInteger(error.status) && error.status > 0 ? error.status : 1;
  }
}
