import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFaaEnvironment, runFaaAnalysis } from './faa-execution.mjs';

const pilotPaths = [
  '.github/scripts/faa-risk-adapter.mjs',
  '.github/scripts/faa-smoke-test.mjs',
  '.github/scripts/faa-premerge-validation.mjs',
  '.github/scripts/faa-execution.mjs',
  '.github/workflows/faa-risk-assessment.yml',
  '.github/workflows/faa-smoke-test.yml',
];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runSmokeTest({ sourceDir, outputDir, env = process.env, execute = execFileSync }) {
  const started = Date.now();
  const record = {
    mode: 'differential', status: 'failed',
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
    const target = env.FAA_SCAN_TARGET || 'packages';
    requireValue(['packages', 'pilot'].includes(target), 'FAA_SCAN_TARGET must be packages or pilot');
    requireValue(target !== 'pilot' || env.GITHUB_REF === 'refs/heads/feature/020-faa-risk-pilot',
      'Pilot validation is restricted to the approved feature branch');
    record.target = target;
    const analyzerEnv = createFaaEnvironment(env);
    record.licensePlatform = env.FAA_LICENSE_PLATFORM;
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
    const paths = target === 'pilot' ? pilotPaths : ['packages'];
    requireValue(git('status', '--porcelain', '--untracked-files=normal', '--', ...paths).trim() === '',
      `${target === 'packages' ? 'Package' : 'Pilot'} checkout must be clean before FAA runs`);
    const range = `${baseSha}..${headSha}`;
    const changed = git('-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-textconv',
      '--name-only', '-z', '--diff-filter=ACMRT', range, '--', ...paths);
    requireValue(changed.length > 0, `No scannable ${target === 'packages' ? 'package' : 'pilot'} changes in this range; choose an earlier base SHA`);
    const changedPaths = changed.split('\0').filter(Boolean);
    requireValue(target !== 'pilot' || changedPaths.every((path) => pilotPaths.includes(path)),
      'Unexpected pilot scan path');
    const scope = target === 'pilot' ? changedPaths.join(',') : 'packages';
    Object.assign(record, {
      baseSha, headSha, range, scope,
      changedFileCount: changedPaths.length,
      buildId: `github-${env.GITHUB_REPOSITORY_ID}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    });
    await runFaaAnalysis({
      sourceDir, outputDir, range, scope, buildId: record.buildId, record, env: analyzerEnv, execute,
    });
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
    `Configured license backend: \`${record.licensePlatform ?? 'not configured'}\``,
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
