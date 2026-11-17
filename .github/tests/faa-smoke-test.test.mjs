import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runSmokeTest } from '../scripts/faa-smoke-test.mjs';

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'faa-smoke-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const sourceDir = join(temp, 'source');
  const outputDir = join(temp, 'output');
  await mkdir(join(sourceDir, 'packages'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', sourceDir, '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '--all');
    git('-c', 'user.name=FAA test', '-c', 'user.email=faa-test@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(temp, 'no-hooks')}`,
      'commit', '-m', 'Smoke-test fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '--template=');
  await writeFile(join(sourceDir, 'packages', 'sample.ts'), 'export const value = 1;\n');
  const baseSha = commit();
  await writeFile(join(sourceDir, 'packages', 'sample.ts'), 'export const value = 2;\n');
  const headSha = commit();
  const env = {
    GITHUB_REPOSITORY: 'fortify-presales/IWA-Agentic', GITHUB_REPOSITORY_ID: '1345239625',
    GITHUB_REF: 'refs/heads/main', GITHUB_SHA: headSha, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_STEP_SUMMARY: join(temp, 'step-summary'),
    FAA_LICENSE_PLATFORM: 'fod', FCLI_DEFAULT_FOD_URL: 'https://fod.example.invalid',
    FCLI_DEFAULT_FOD_CLIENT_ID: 'test-client-id', FCLI_DEFAULT_FOD_CLIENT_SECRET: 'test-client-secret',
  };
  const calls = [];
  const execute = (command, args, options) => {
    if (command === 'git') return execFileSync(command, args, options);
    assert.equal(command, 'fortifyaa');
    calls.push(args);
    if (args[0] === '-help') return 'OpenText Fortify Agentic Analyzer (FAA) 26.4.0\n';
    assert.equal(args[0], '-scan');
    writeFileSync(join(outputDir, 'faa.sarif'), JSON.stringify({ version: '2.1.0', runs: [{ results: [] }] }));
    writeFileSync(join(outputDir, 'faa-summary.md'), '# No introduced findings\n');
    return '';
  };
  return { sourceDir, outputDir, env, execute, calls, baseSha, headSha, git, commit };
}

test('default range is first parent to exact head; only one differential scan runs', async (t) => {
  const f = await fixture(t);
  const record = await runSmokeTest(f);
  assert.equal(record.status, 'succeeded');
  assert.equal(record.range, `${f.baseSha}..${f.headSha}`);
  assert.equal(record.findingCount, 0);
  assert.equal(record.analyzerExitCode, 0);
  const scans = f.calls.filter((args) => args[0] === '-scan');
  assert.equal(scans.length, 1);
  const args = scans[0];
  assert.equal(args[args.indexOf('--differential') + 1], record.range);
  assert.equal(args[args.indexOf('--scope') + 1], 'packages');
  assert.ok(!args.some((arg) => ['--incremental', '--baseline', '--fod-release', '--ssc-appversion', '-selftest', '-clean'].includes(arg)));
  assert.ok(args.includes(record.buildId));
  assert.match(record.buildId, /42-1$/);
  assert.equal(JSON.parse(await readFile(join(f.outputDir, 'faa-execution.json'), 'utf8')).status, 'succeeded');
  assert.match(await readFile(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /Status: \*\*succeeded\*\*/);
});

test('explicit ancestor base and rerun attempt select a fresh build identity', async (t) => {
  const f = await fixture(t);
  f.env.FAA_BASE_SHA = f.baseSha.toUpperCase();
  f.env.GITHUB_RUN_ATTEMPT = '2';
  const result = await runSmokeTest(f);
  assert.equal(result.baseSha, f.baseSha);
  assert.match(result.buildId, /42-2$/);
});

test('approved pilot branch scans the exact dispatched head and records its ref', async (t) => {
  const f = await fixture(t);
  f.env.GITHUB_REF = 'refs/heads/feature/020-faa-risk-pilot';
  const record = await runSmokeTest(f);
  assert.equal(record.status, 'succeeded');
  assert.equal(record.headSha, f.headSha);
  assert.equal(record.ref, f.env.GITHUB_REF);
  assert.equal(f.calls.filter((args) => args[0] === '-scan').length, 1);
  const saved = JSON.parse(await readFile(join(f.outputDir, 'faa-execution.json'), 'utf8'));
  assert.equal(saved.ref, f.env.GITHUB_REF);
});

for (const platform of ['fod', 'ssc']) {
  test(`${platform} licensing forwards only the selected backend through the FAA environment`, async (t) => {
    const f = await fixture(t);
    f.env.FAA_LICENSE_PLATFORM = platform;
    f.env.FCLI_DEFAULT_SSC_URL = 'https://ssc.example.invalid/ssc';
    f.env.FCLI_DEFAULT_SSC_TOKEN = 'test-ssc-token';
    const selectedKey = platform === 'fod' ? 'FCLI_DEFAULT_FOD_CLIENT_SECRET' : 'FCLI_DEFAULT_SSC_TOKEN';
    const unusedPrefix = platform === 'fod' ? 'FCLI_DEFAULT_SSC_' : 'FCLI_DEFAULT_FOD_';
    f.env[`${unusedPrefix}USER`] = 'unused-runner-user';
    const execute = (command, args, options) => {
      if (command === 'fortifyaa') {
        assert.equal(options.env[selectedKey], f.env[selectedKey]);
        assert.ok(!Object.keys(options.env).some((key) => key.startsWith(unusedPrefix)));
        assert.ok(!args.some((arg) => arg.includes(f.env[selectedKey])));
      }
      return f.execute(command, args, options);
    };
    const record = await runSmokeTest({ ...f, execute });
    assert.equal(record.status, 'succeeded');
    assert.equal(record.licensePlatform, platform);
    for (const file of ['faa-execution.json', 'faa-execution-summary.md']) {
      const output = await readFile(join(f.outputDir, file), 'utf8');
      assert.ok(!output.includes(f.env.FCLI_DEFAULT_FOD_CLIENT_SECRET));
      assert.ok(!output.includes(f.env.FCLI_DEFAULT_SSC_TOKEN));
    }
  });
}

test('unsupported platforms or missing selected credentials fail before FAA without disclosing values', async (t) => {
  const f = await fixture(t);
  for (const overrides of [
    { FAA_LICENSE_PLATFORM: undefined },
    { FAA_LICENSE_PLATFORM: 'auto' },
    { FCLI_DEFAULT_FOD_URL: '' },
    { FCLI_DEFAULT_FOD_CLIENT_ID: undefined },
    { FCLI_DEFAULT_FOD_CLIENT_SECRET: ' ' },
    { FAA_LICENSE_PLATFORM: 'ssc' },
    { FAA_LICENSE_PLATFORM: 'ssc', FCLI_DEFAULT_SSC_URL: 'https://ssc.example.invalid/ssc' },
    { FAA_LICENSE_PLATFORM: 'ssc', FCLI_DEFAULT_SSC_TOKEN: 'test-ssc-token' },
  ]) {
    await assert.rejects(runSmokeTest({ ...f, env: { ...f.env, ...overrides } }), /FAA_LICENSE_PLATFORM|Missing FCLI_DEFAULT_/);
    assert.equal(f.calls.length, 0);
    const output = await readFile(join(f.outputDir, 'faa-execution.json'), 'utf8');
    assert.equal(JSON.parse(output).status, 'failed');
    assert.ok(!output.includes(f.env.FCLI_DEFAULT_FOD_CLIENT_SECRET));
  }
});

test('unapproved refs, foreign repositories and invalid ranges fail before any FAA call', async (t) => {
  const f = await fixture(t);
  for (const overrides of [
    { GITHUB_REF: 'refs/heads/feature/example' },
    { GITHUB_REF: 'refs/heads/feature/020-faa-risk-pilot-unreviewed' },
    { GITHUB_REF: 'refs/tags/main' },
    { GITHUB_REF: 'refs/pull/42/merge' },
    { GITHUB_REPOSITORY: 'another/repository' },
    { GITHUB_REPOSITORY: 'another/repository', GITHUB_REF: 'refs/heads/feature/020-faa-risk-pilot' },
    { GITHUB_SHA: 'a'.repeat(40) },
    { FAA_BASE_SHA: 'HEAD~1; touch injected' },
    { FAA_BASE_SHA: 'HEAD~1' },
    { FAA_BASE_SHA: f.headSha },
    { FAA_BASE_SHA: 'b'.repeat(40) },
  ]) {
    await assert.rejects(runSmokeTest({ ...f, env: { ...f.env, ...overrides } }));
    assert.equal(f.calls.length, 0);
    const record = JSON.parse(await readFile(join(f.outputDir, 'faa-execution.json'), 'utf8'));
    assert.equal(record.status, 'failed');
    assert.equal(record.analyzerInvoked, false);
  }
});

test('non-ancestor base cannot broaden a scan to an unrelated history', async (t) => {
  const f = await fixture(t);
  f.git('checkout', '--orphan', 'unrelated');
  await writeFile(join(f.sourceDir, 'unrelated.txt'), 'unrelated\n');
  const unrelated = f.commit();
  f.git('checkout', '--detach', f.headSha);
  await assert.rejects(runSmokeTest({ ...f, env: { ...f.env, FAA_BASE_SHA: unrelated } }));
  assert.equal(f.calls.length, 0);
});

test('docs-only or dirty package changes fail without invoking FAA', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.sourceDir, 'README.md'), 'Documentation only\n');
  const docsHead = f.commit();
  await assert.rejects(runSmokeTest({ ...f, env: { ...f.env, GITHUB_SHA: docsHead } }), /No scannable package changes/);
  assert.equal(f.calls.length, 0);
  await writeFile(join(f.sourceDir, 'packages', 'sample.ts'), 'dirty\n');
  await assert.rejects(runSmokeTest({
    ...f, env: { ...f.env, GITHUB_SHA: docsHead, FAA_BASE_SHA: f.baseSha },
  }), /must be clean/);
  assert.equal(f.calls.length, 0);
});

test('wrong FAA version fails before scanning', async (t) => {
  const f = await fixture(t);
  const execute = (command, args, options) => command === 'fortifyaa' ? 'FAA 26.3.0' : f.execute(command, args, options);
  await assert.rejects(runSmokeTest({ ...f, execute }), /requires FAA 26.4.0/);
  const record = JSON.parse(await readFile(join(f.outputDir, 'faa-execution.json'), 'utf8'));
  assert.equal(record.analyzerInvoked, false);
  assert.equal(record.status, 'failed');
});

test('FAA process failures remain failures and retain execution evidence', async (t) => {
  const f = await fixture(t);
  const execute = (command, args, options) => {
    if (command === 'fortifyaa' && args[0] === '-scan') {
      const error = new Error('Analyzer service unavailable');
      error.status = 7;
      throw error;
    }
    return f.execute(command, args, options);
  };
  await assert.rejects(runSmokeTest({ ...f, execute }), /service unavailable/);
  const record = JSON.parse(await readFile(join(f.outputDir, 'faa-execution.json'), 'utf8'));
  assert.equal(record.status, 'failed');
  assert.equal(record.analyzerInvoked, true);
  assert.equal(record.analyzerExitCode, 7);
});

test('zero exit without valid SARIF and Markdown is not a successful smoke test', async (t) => {
  const f = await fixture(t);
  const noOutputs = (command, args, options) => command === 'fortifyaa' && args[0] === '-scan' ? '' : f.execute(command, args, options);
  await assert.rejects(runSmokeTest({ ...f, execute: noOutputs }), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(join(f.outputDir, 'faa-execution.json'), 'utf8')).status, 'failed');
  for (const sarif of ['not json', 'null', '{"version":"2.1.0","runs":[]}', '{"version":"2.1.0","runs":[{"results":{}}]}']) {
    const execute = (command, args, options) => {
      const result = f.execute(command, args, options);
      if (command === 'fortifyaa' && args[0] === '-scan') writeFileSync(join(f.outputDir, 'faa.sarif'), sarif);
      return result;
    };
    await assert.rejects(runSmokeTest({ ...f, execute }));
    assert.equal(JSON.parse(await readFile(join(f.outputDir, 'faa-execution.json'), 'utf8')).status, 'failed');
  }
  const execute = (command, args, options) => {
    const result = f.execute(command, args, options);
    if (command === 'fortifyaa' && args[0] === '-scan') writeFileSync(join(f.outputDir, 'faa-summary.md'), '');
    return result;
  };
  await assert.rejects(runSmokeTest({ ...f, execute }), /summary is missing or empty/);
});
