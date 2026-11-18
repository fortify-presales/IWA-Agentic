import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function selectExecution(result, event, enabled) {
  if (!result.mandatory) return result.decision === 'faa-recommended' ? 'advisory-only' : 'not-selected';
  if (event.pull_request.head.repo?.id !== event.repository.id) return 'skipped-fork';
  if (enabled !== 'true') return 'disabled';
  return 'pending-execution';
}

export function createFaaEnvironment(env) {
  const platform = env.FAA_LICENSE_PLATFORM;
  if (!['fod', 'ssc'].includes(platform)) throw new Error('FAA_LICENSE_PLATFORM must be fod or ssc');
  const keys = platform === 'fod'
    ? ['FCLI_DEFAULT_FOD_URL', 'FCLI_DEFAULT_FOD_CLIENT_ID', 'FCLI_DEFAULT_FOD_CLIENT_SECRET']
    : ['FCLI_DEFAULT_SSC_URL', 'FCLI_DEFAULT_SSC_TOKEN'];
  for (const key of keys) {
    if (typeof env[key] !== 'string' || !env[key].trim()) {
      throw new Error(`Missing ${key}; configure the selected FAA license backend in Actions`);
    }
  }
  const result = { ...env };
  const unusedPrefix = platform === 'fod' ? 'FCLI_DEFAULT_SSC_' : 'FCLI_DEFAULT_FOD_';
  for (const key of Object.keys(result)) {
    if (key.startsWith(unusedPrefix) || ['GH_TOKEN', 'GITHUB_TOKEN', 'FAA_GITHUB_TOKEN'].includes(key)) {
      delete result[key];
    }
  }
  return result;
}

export async function runFaaAnalysis({
  sourceDir, outputDir, range, scope, buildId, record, env, cwd = sourceDir, execute = execFileSync,
}) {
  const help = execute('fortifyaa', ['-help'], {
    env, cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!/\b26\.4\.0\b/.test(help)) throw new Error('This scan requires FAA 26.4.0 on PATH');
  record.analyzerVersion = '26.4.0';
  await Promise.all(['faa.sarif', 'faa-summary.md'].map((name) => rm(join(outputDir, name), { force: true })));
  record.analyzerInvoked = true;
  execute('fortifyaa', [
    '-scan', sourceDir, '--scope', scope, '--differential', range,
    '--output', join(outputDir, 'faa.sarif'), '--output-format', 'sarif,md-summary',
    '--output-md-summary', join(outputDir, 'faa-summary.md'), '--message-format', 'plain',
    '-b', buildId,
  ], { cwd, env, stdio: 'inherit' });
  record.analyzerExitCode = 0;
  const sarif = JSON.parse(await readFile(join(outputDir, 'faa.sarif'), 'utf8'));
  if (sarif?.version !== '2.1.0' || !Array.isArray(sarif.runs) || !sarif.runs.length) {
    throw new Error('FAA did not produce a valid SARIF run');
  }
  if (!sarif.runs.every((run) => run && (run.results === undefined || Array.isArray(run.results)))) {
    throw new Error('Invalid SARIF results');
  }
  record.findingCount = sarif.runs.reduce((count, run) => count + (run.results?.length ?? 0), 0);
  if (!(await readFile(join(outputDir, 'faa-summary.md'), 'utf8')).trim()) {
    throw new Error('FAA Markdown summary is missing or empty');
  }
}
