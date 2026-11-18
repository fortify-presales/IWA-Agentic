import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { selectExecution } from '../scripts/faa-execution.mjs';
import { runPrScan } from '../scripts/faa-pr-scan.mjs';

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'faa-pr-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const sourceDir = join(temp, 'source');
  const controlDir = join(temp, 'controls');
  const outputDir = join(temp, 'output');
  await mkdir(join(sourceDir, '.github', 'scripts'), { recursive: true });
  const policy = await readFile(new URL('../faa-policy.json', import.meta.url), 'utf8');
  await writeFile(join(sourceDir, '.github', 'faa-policy.json'), policy);
  await writeFile(join(sourceDir, 'sample.ts'), 'export const value = 1;\n');
  const gitAt = (directory, ...args) => execFileSync('git', [
    '-C', directory, '-c', 'core.autocrlf=false', ...args,
  ], { encoding: 'utf8' }).trim();
  const git = (...args) => gitAt(sourceDir, ...args);
  const commit = (directory = sourceDir) => {
    gitAt(directory, 'add', '--all');
    gitAt(directory, '-c', 'user.name=FAA test', '-c', 'user.email=faa-test@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(temp, 'no-hooks')}`,
      'commit', '-m', 'PR execution fixture');
    return gitAt(directory, 'rev-parse', 'HEAD');
  };
  git('init', '--template=');
  const baseSha = commit();
  execFileSync('git', ['clone', '--no-hardlinks', '--template=', '--config', 'core.autocrlf=false',
    sourceDir, controlDir], { stdio: 'pipe' });
  await writeFile(join(sourceDir, 'sample.ts'), 'export const value = 2;\n');
  await writeFile(join(sourceDir, '.github', 'faa-policy.json'), '{"invalid":"PR policy must not be loaded"}\n');
  await writeFile(join(sourceDir, '.github', 'scripts', 'faa-pr-scan.mjs'), 'throw new Error("PR helper must not run");\n');
  const headSha = commit();
  const event = {
    repository: { id: 123, full_name: 'fortify-presales/IWA-Agentic' },
    pull_request: {
      number: 42, draft: false, body: '', labels: [{ name: 'faa-required' }],
      base: { ref: 'main', sha: baseSha, repo: { id: 123 } },
      head: { sha: headSha, repo: { id: 123 } },
    },
  };
  const env = {
    ...process.env, GITHUB_EVENT_NAME: 'pull_request_target',
    GITHUB_REPOSITORY: 'fortify-presales/IWA-Agentic',
    GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '2', FAA_TRUSTED_CONTROL_SHA: baseSha,
    FAA_PR_SCANS_ENABLED: 'true', FAA_LICENSE_PLATFORM: 'fod',
    FCLI_DEFAULT_FOD_URL: 'https://fod.example.invalid', FCLI_DEFAULT_FOD_CLIENT_ID: 'test-client',
    FCLI_DEFAULT_FOD_CLIENT_SECRET: 'test-fod-secret', FCLI_DEFAULT_SSC_URL: 'unused-ssc',
    FCLI_DEFAULT_SSC_TOKEN: 'unused-token', FCLI_DEFAULT_SSC_USER: 'unused-user',
    FAA_GITHUB_TOKEN: 'test-readonly-token', GITHUB_TOKEN: 'test-github-token', GH_TOKEN: 'test-gh-token',
    OPENAI_API_KEY: 'test-openai-key', GITHUB_STEP_SUMMARY: join(temp, 'step-summary'),
  };
  const calls = [];
  const execute = (command, args, options) => {
    if (command === 'git') return execFileSync(command, args, options);
    assert.equal(command, 'fortifyaa', 'Only Git and FAA may execute; no PR scripts');
    calls.push({ args, options });
    if (args[0] === '-help') return 'OpenText Fortify Agentic Analyzer (FAA) 26.4.0';
    writeFileSync(join(outputDir, 'faa.sarif'), JSON.stringify({ version: '2.1.0', runs: [{ results: [{}] }] }));
    writeFileSync(join(outputDir, 'faa-summary.md'), '# One finding\n');
    return '';
  };
  const getPullRequest = async () => ({ ...structuredClone(event.pull_request), state: 'open' });
  return { temp, sourceDir, controlDir, outputDir, event, env, execute, calls, getPullRequest, git, gitAt, commit };
}

test('execution selection keeps advisory/low-risk/fork/disabled decisions distinct', () => {
  const event = { repository: { id: 123 }, pull_request: { head: { repo: { id: 123 } } } };
  assert.equal(selectExecution({ mandatory: false, decision: 'sast-sca-only' }, event, 'true'), 'not-selected');
  assert.equal(selectExecution({ mandatory: false, decision: 'faa-recommended' }, event, 'true'), 'advisory-only');
  const mandatory = { mandatory: true, decision: 'faa-mandatory' };
  assert.equal(selectExecution(mandatory, event, 'false'), 'disabled');
  assert.equal(selectExecution(mandatory, event, undefined), 'disabled');
  assert.equal(selectExecution(mandatory, event, 'true'), 'pending-execution');
  event.pull_request.head.repo.id = 456;
  assert.equal(selectExecution(mandatory, event, 'true'), 'skipped-fork');
});

test('mandatory PR uses immutable base controls, head data and environment-only credentials', async (t) => {
  const f = await fixture(t);
  const record = await runPrScan(f);
  assert.equal(record.status, 'succeeded');
  assert.equal(record.headSha, f.event.pull_request.head.sha);
  assert.equal(record.controlSha, f.event.pull_request.base.sha);
  assert.equal(record.range, `${record.controlSha}..${record.headSha}`);
  assert.equal(record.findingCount, 1, 'Findings are retained, not an audit-mode release gate');
  assert.equal(record.analyzerExitCode, 0);
  assert.equal(record.buildId, 'github-pr-123-99-2');
  assert.equal(f.calls.length, 2);
  const { args, options } = f.calls[1];
  assert.equal(args[args.indexOf('-scan') + 1], f.sourceDir);
  assert.equal(args[args.indexOf('--scope') + 1], f.sourceDir);
  assert.equal(args[args.indexOf('--differential') + 1], record.range);
  for (const call of f.calls) {
    assert.equal(call.options.cwd, f.controlDir);
    assert.ok(!Object.keys(call.options.env).some((key) => key.startsWith('FCLI_DEFAULT_SSC_')));
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'FAA_GITHUB_TOKEN']) assert.equal(call.options.env[key], undefined);
  }
  assert.equal(options.env.OPENAI_API_KEY, f.env.OPENAI_API_KEY);
  assert.ok(!args.some((arg) => ['--incremental', '--baseline', '--fod-release', '--ssc-appversion'].includes(arg)));
  const evidence = await readFile(join(f.outputDir, 'faa-pr-execution.json'), 'utf8');
  assert.equal(JSON.parse(evidence).assessmentId, `123:42:${record.headSha}:99:2`);
  assert.ok(!evidence.includes(f.env.FCLI_DEFAULT_FOD_CLIENT_SECRET));
  assert.ok(!evidence.includes(f.env.OPENAI_API_KEY));
  assert.match(await readFile(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /Status: \*\*succeeded\*\*/);
});

test('disabled, advisory, low-risk and fork selections do not invoke FAA or request credentials', async (t) => {
  const f = await fixture(t);
  const cases = [
    { status: 'disabled', enabled: 'false', labels: [{ name: 'faa-required' }], body: '' },
    { status: 'advisory-only', enabled: 'true', labels: [], body: '- AI assistance used: significant' },
    { status: 'not-selected', enabled: 'true', labels: [], body: '' },
    { status: 'skipped-fork', enabled: 'true', labels: [{ name: 'faa-required' }], body: '', fork: true },
  ];
  for (const entry of cases) {
    const event = structuredClone(f.event);
    Object.assign(event.pull_request, { body: entry.body, labels: entry.labels });
    if (entry.fork) event.pull_request.head.repo.id = 456;
    const record = await runPrScan({
      ...f, event, env: { ...f.env, FAA_PR_SCANS_ENABLED: entry.enabled, FCLI_DEFAULT_FOD_CLIENT_SECRET: '' },
      getPullRequest: async () => { throw new Error('Unselected execution must not query GitHub'); },
    });
    assert.equal(record.status, entry.status);
    assert.equal(record.analyzerInvoked, false);
  }
  assert.equal(f.calls.length, 0);
});

test('wrong event, draft, mismatched controls/head and overlapping directories fail before FAA', async (t) => {
  const f = await fixture(t);
  for (const overrides of [
    { env: { ...f.env, GITHUB_EVENT_NAME: 'pull_request' } },
    { env: { ...f.env, FAA_TRUSTED_CONTROL_SHA: 'a'.repeat(40) } },
    { controlDir: f.sourceDir },
    { sourceDir: f.controlDir },
    { event: { ...f.event, pull_request: { ...f.event.pull_request, draft: true } } },
    { event: { ...f.event, pull_request: { ...f.event.pull_request,
      head: { ...f.event.pull_request.head, sha: 'b'.repeat(40) } } } },
  ]) {
    await assert.rejects(runPrScan({ ...f, ...overrides }));
    assert.equal(f.calls.length, 0);
    assert.equal(JSON.parse(await readFile(join(f.outputDir, 'faa-pr-execution.json'), 'utf8')).status, 'failed');
  }
  await assert.rejects(runPrScan({ ...f, outputDir: join(f.sourceDir, '..outputs') }),
    /outputs must be outside PR source/);
  assert.equal(f.calls.length, 0);
});

test('changed PR head, base, state, declarations or labels skips stale events before FAA', async (t) => {
  const f = await fixture(t);
  for (const update of [
    (pr) => { pr.head.sha = 'b'.repeat(40); },
    (pr) => { pr.base.sha = 'c'.repeat(40); },
    (pr) => { pr.state = 'closed'; },
    (pr) => { pr.draft = true; },
    (pr) => { pr.body = '- Authentication or authorization changed: no'; },
    (pr) => { pr.labels = []; },
  ]) {
    const current = await f.getPullRequest();
    update(current);
    const record = await runPrScan({ ...f, getPullRequest: async () => current });
    assert.equal(record.status, 'skipped-stale');
    assert.equal(record.analyzerInvoked, false);
    assert.equal(f.calls.length, 0);
  }
});

test('a PR updated during analysis cannot receive a successful attestation', async (t) => {
  const f = await fixture(t);
  let queries = 0;
  const record = await runPrScan({ ...f, getPullRequest: async () => {
    const current = await f.getPullRequest();
    if (++queries > 1) current.head.sha = 'b'.repeat(40);
    return current;
  } });
  assert.equal(record.status, 'stale');
  assert.equal(record.analyzerInvoked, true);
  assert.equal(record.analyzerExitCode, 0);
});

test('deleted-only ranges skip FAA and changed source during analysis fails', async (t) => {
  const f = await fixture(t);
  const execute = (command, args, options) => {
    const result = f.execute(command, args, options);
    if (command === 'fortifyaa' && args[0] === '-scan') {
      writeFileSync(join(f.sourceDir, 'sample.ts'), 'changed by analyzer\n');
    }
    return result;
  };
  await assert.rejects(runPrScan({ ...f, execute }), /source changed during analysis/);
  assert.equal(JSON.parse(await readFile(join(f.outputDir, 'faa-pr-execution.json'), 'utf8')).status, 'failed');
  await writeFile(join(f.sourceDir, '.github', 'faa-policy.json'),
    await readFile(join(f.controlDir, '.github', 'faa-policy.json')));
  await rm(join(f.sourceDir, '.github', 'scripts', 'faa-pr-scan.mjs'));
  await rm(join(f.sourceDir, 'sample.ts'));
  f.event.pull_request.head.sha = f.commit();
  f.calls.length = 0;
  const record = await runPrScan(f);
  assert.equal(record.status, 'skipped-no-changes');
  assert.equal(record.changedFileCount, 0);
  assert.equal(record.analyzerInvoked, false);
  assert.equal(f.calls.length, 0);
});

test('unsafe tree entries and dirty input are rejected without executing FAA', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.sourceDir, 'sample.ts'), 'uncommitted\n');
  await assert.rejects(runPrScan(f), /checkout must be clean/);
  f.git('add', '--all');
  f.git('-c', 'user.name=FAA test', '-c', 'user.email=faa-test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(f.temp, 'no-hooks')}`,
    'commit', '-m', 'Dirty input fixture');
  f.event.pull_request.head.sha = f.git('rev-parse', 'HEAD');
  for (const mode of ['120000', '160000']) {
    const execute = (command, args, options) => {
      if (command === 'git' && args.includes('--stage')) return `${mode} ${'a'.repeat(40)} 0\tunsafe-entry\0`;
      return f.execute(command, args, options);
    };
    await assert.rejects(runPrScan({ ...f, execute }), /symlinks and submodules/);
  }
  assert.equal(f.calls.length, 0);
  await writeFile(join(f.controlDir, 'unexpected.txt'), 'Unexpected control modification\n');
  await assert.rejects(runPrScan(f), /Trusted control checkout must be clean/);
  assert.equal(f.calls.length, 0);
});

test('diverged base uses the merge-base to head differential range', async (t) => {
  const f = await fixture(t);
  const mergeBase = f.event.pull_request.base.sha;
  await writeFile(join(f.controlDir, 'base-only.ts'), 'export const baseOnly = true;\n');
  const newBase = f.commit(f.controlDir);
  f.git('fetch', f.controlDir, newBase);
  f.event.pull_request.base.sha = newBase;
  f.env.FAA_TRUSTED_CONTROL_SHA = newBase;
  const record = await runPrScan(f);
  assert.equal(record.baseSha, newBase);
  assert.equal(record.diffBaseSha, mergeBase);
  assert.equal(record.range, `${mergeBase}..${record.headSha}`);
});

test('GitHub API errors, FAA failures, and malformed outputs are recorded and rethrown', async (t) => {
  const f = await fixture(t);
  await assert.rejects(runPrScan({ ...f, getPullRequest: async () => {
    throw new Error('GitHub unavailable');
  } }), /GitHub unavailable/);
  assert.equal(f.calls.length, 0);
  const failed = (command, args, options) => {
    if (command === 'fortifyaa' && args[0] === '-scan') {
      const error = new Error('Analyzer failed');
      error.status = 7;
      throw error;
    }
    return f.execute(command, args, options);
  };
  await assert.rejects(runPrScan({ ...f, execute: failed }), /Analyzer failed/);
  const record = JSON.parse(await readFile(join(f.outputDir, 'faa-pr-execution.json'), 'utf8'));
  assert.equal(record.status, 'failed');
  assert.equal(record.analyzerExitCode, 7);
  const malformed = (command, args, options) => {
    const result = f.execute(command, args, options);
    if (command === 'fortifyaa' && args[0] === '-scan') writeFileSync(join(f.outputDir, 'faa.sarif'), '{}');
    return result;
  };
  await assert.rejects(runPrScan({ ...f, execute: malformed }), /valid SARIF/);
  assert.equal(JSON.parse(await readFile(join(f.outputDir, 'faa-pr-execution.json'), 'utf8')).status, 'failed');
  const noOutputs = (command, args, options) => {
    if (command === 'fortifyaa' && args[0] === '-scan') return '';
    return f.execute(command, args, options);
  };
  await assert.rejects(runPrScan({ ...f, execute: noOutputs }), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(join(f.outputDir, 'faa-pr-execution.json'), 'utf8')).status, 'failed');
});

test('pre-merge validation pins PR 26 controls/head while preserving the real base and trigger', async (t) => {
  const f = await fixture(t);
  const baseSha = f.event.pull_request.base.sha;
  await writeFile(join(f.sourceDir, '.github', 'faa-policy.json'),
    await readFile(join(f.controlDir, '.github', 'faa-policy.json')));
  const approvedControlSha = f.commit();
  f.gitAt(f.controlDir, 'fetch', f.sourceDir, approvedControlSha);
  f.gitAt(f.controlDir, 'switch', '--detach', approvedControlSha);
  f.event.pull_request.number = 26;
  f.event.pull_request.head.sha = approvedControlSha;
  Object.assign(f.env, {
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: baseSha, FAA_TRUSTED_CONTROL_SHA: approvedControlSha,
  });
  const record = await runPrScan({ ...f, approvedControlSha });
  assert.equal(record.status, 'succeeded');
  assert.equal(record.baseSha, baseSha);
  assert.equal(record.controlSha, approvedControlSha);
  assert.equal(record.headSha, approvedControlSha);
  assert.equal(record.executionContext, 'premerge-validation');
  assert.equal(record.triggerEvent, 'workflow_dispatch');
  assert.equal(record.launcherSha, baseSha);
  const risk = JSON.parse(await readFile(join(f.outputDir, 'faa-risk-result.json'), 'utf8'));
  assert.equal(risk.decision, 'faa-mandatory');
  assert.equal(risk.faaExecution.status, 'pending-execution');
  assert.equal(risk.policySha256.length, 64);
  assert.equal(risk.assessmentId, record.assessmentId);
  assert.equal(risk.controlSha, approvedControlSha);
  assert.equal(risk.baseSha, baseSha);
  f.calls.length = 0;
  for (const overrides of [
    { approvedControlSha: undefined },
    { env: { ...f.env, GITHUB_EVENT_NAME: 'pull_request_target' } },
    { env: { ...f.env, GITHUB_REF: 'refs/heads/feature/021-faa-pr-execution' } },
    { env: { ...f.env, GITHUB_SHA: 'main' } },
    { approvedControlSha: 'main' },
    { approvedControlSha: baseSha },
    { event: { ...f.event, pull_request: { ...f.event.pull_request, number: 27 } } },
    { env: { ...f.env, FAA_TRUSTED_CONTROL_SHA: baseSha } },
  ]) {
    await assert.rejects(runPrScan({ ...f, approvedControlSha, ...overrides }));
    assert.equal(f.calls.length, 0);
  }
  await assert.rejects(runPrScan({
    ...f, env: { ...f.env, GITHUB_EVENT_NAME: 'pull_request_target', FAA_APPROVED_CONTROL_SHA: approvedControlSha },
  }), /Control checkout does not match/);
  assert.equal(f.calls.length, 0, 'An environment variable cannot enable the library-only validation mode');
});
