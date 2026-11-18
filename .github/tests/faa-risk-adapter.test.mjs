import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assessPullRequest, formatSummary, parseDeclarations, parseNumstat, runAdapter,
  validatePolicy, validateResult,
} from '../scripts/faa-risk-adapter.mjs';

const actualPolicy = JSON.parse(await readFile(new URL('../faa-policy.json', import.meta.url), 'utf8'));
const neutralPolicy = () => {
  const policy = structuredClone(actualPolicy);
  policy.application.internetFacing = false;
  return policy;
};
const event = (body = '') => ({
  repository: { id: 123, full_name: 'example/another-repository' },
  pull_request: {
    number: 7, draft: false, body, labels: [],
    base: { sha: 'a'.repeat(40), repo: { id: 123 } },
    head: { sha: 'b'.repeat(40) },
  },
});
const change = (path, added = 1, deleted = 0) => ({ paths: [path], added, deleted, binary: false });
const assess = (body, changes = [], policy = neutralPolicy()) => assessPullRequest(event(body), changes, policy);

test('ordinary/docs changes and predominant AI alone stay below recommendation in neutral metadata', () => {
  for (const changes of [[], [change('README.md', 2000)], [change('packages/web/src/cart.ts', 3)]]) {
    assert.equal(assess('', changes).decision, 'sast-sca-only');
  }
  const result = assess('- AI assistance used: predominant\n- AI-generated code manually reviewed: yes');
  assert.equal(result.score, 2);
  assert.equal(result.mandatory, false);
  assert.equal(result.decision, 'sast-sca-only');
});

test('pilot metadata has a standing score; docs do not receive an undocumented exemption', () => {
  const result = assess('', [change('README.md', 2000)], actualPolicy);
  assert.equal(result.score, 4);
  assert.equal(result.changedLines, 0);
  assert.equal(result.application.classificationStatus, 'pilot-assumption');
  const critical = neutralPolicy();
  critical.application.tier = 'tier-1';
  critical.application.dataClassification = 'restricted';
  assert.equal(assess('', [change('README.md')], critical).decision, 'faa-mandatory');
});

test('threshold boundaries are exact, and numerical mandatory is reflected in the mandatory flag', () => {
  for (const [score, decision] of [[4, 'sast-sca-only'], [5, 'faa-recommended'], [8, 'faa-recommended'], [9, 'faa-mandatory']]) {
    const policy = neutralPolicy();
    policy.application.internetFacing = true;
    policy.scores['internet-facing'] = score;
    const result = assess('', [], policy);
    assert.equal(result.score, score);
    assert.equal(result.decision, decision);
    assert.equal(result.mandatory, score >= 9);
  }
});

test('path evidence overrides negative declarations, deduplicates signals, and survives label removal', () => {
  const input = event('- Authentication or authorization changed: no');
  input.pull_request.labels = [{ name: 'faa-required' }];
  const changes = [change('packages/api/src/services/AuthService.ts'), change('packages/api/src/middleware/requireRole.ts')];
  const withLabel = assessPullRequest(input, changes, neutralPolicy());
  assert.equal(withLabel.decision, 'faa-mandatory');
  input.pull_request.labels = [];
  const result = assessPullRequest(input, changes, neutralPolicy());
  assert.equal(result.score, 5);
  assert.equal(result.mandatory, true);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.reasons[0].evidence.length, 2);
  assert.equal(result.reasons.filter((r) => r.signal === 'authentication-authorization').length, 1);
  assert.equal(assessPullRequest(event(), [], neutralPolicy()).decision, 'sast-sca-only');
  for (const path of ['services/UserService.ts', 'web/default.ts', 'web/user.ts', 'web/userPublic.ts']) {
    assert.equal(assess('', [change(`packages/api/src/${path}`)]).mandatory, true);
  }
});

test('required label alone is mandatory; unknown and low-risk labels cannot lower risk', () => {
  const input = event();
  input.pull_request.labels = [{ name: 'faa-required' }, { name: 'low-risk' }];
  const result = assessPullRequest(input, [], neutralPolicy());
  assert.equal(result.score, 0);
  assert.equal(result.mandatory, true);
  assert.equal(result.decision, 'faa-mandatory');
});

test('mandatory overrides and label names are configurable for another repository', () => {
  const policy = neutralPolicy();
  policy.mandatorySignals = [];
  policy.mandatoryInternetApi = false;
  policy.requiredLabels = ['run-faa'];
  policy.application.internetFacing = true;
  policy.scores['authentication-authorization'] = 1;
  const input = event('- Authentication or authorization changed: yes\n- New or materially changed API: yes');
  policy.scores['new-api'] = 1;
  input.pull_request.labels = [{ name: 'faa-required' }];
  const result = assessPullRequest(input, [], policy);
  assert.equal(result.repository, 'example/another-repository');
  assert.equal(result.score, 6);
  assert.equal(result.mandatory, false);
  input.pull_request.labels = [{ name: 'run-faa' }];
  assert.equal(assessPullRequest(input, [], policy).mandatory, true);
});

test('secrets and incident declarations trigger mandatory; API requires internet exposure for override', () => {
  assert.equal(assess('', [change('packages/api/src/utils/crypto.ts')]).mandatory, true);
  assert.equal(assess('- Previous security incident area changed: yes').mandatory, true);
  assert.equal(assess('', [change('packages/api/src/api/v3/products.ts')]).mandatory, false);
  const exposed = assess('', [change('packages/api/src/api/v3/products.ts')], actualPolicy);
  assert.equal(exposed.score, 8);
  assert.equal(exposed.mandatory, true);
  assert.equal(exposed.faaExecution.status, 'pending-execution');
  const policy = neutralPolicy();
  policy.paths['previous-incident-area'] = ['^packages/web/src/incident\\.ts$'];
  assert.equal(assess('', [change('packages/web/src/incident.ts')], policy).mandatory, true);
});

test('executable size uses general/high-risk thresholds and lock files remain dependency signals', () => {
  for (const [lines, large] of [[1499, false], [1500, true]]) {
    assert.equal(assess('', [change('packages/web/src/cart.ts', lines)]).reasons.some((r) => r.signal === 'large-change'), large);
  }
  for (const [lines, large] of [[499, false], [500, true]]) {
    assert.equal(assess('- New integration or trust boundary: yes', [change('packages/web/src/cart.ts', lines)])
      .reasons.some((r) => r.signal === 'large-change'), large);
  }
  const result = assess('- AI assistance used: predominant\n- AI-generated code manually reviewed: yes', [
    change('packages/web/src/cart.ts', 2000), change('package-lock.json', 5000),
  ]);
  assert.equal(result.changedLines, 2000);
  assert.equal(result.score, 6);
  assert.equal(result.decision, 'faa-recommended');
  assert.equal(assess('', [change('Src/packages/api/src/app.ts', 2000)]).changedLines, 0);
  const mixed = assess('', [change('packages/api/src/services/AuthService.ts', 1), change('packages/web/src/cart.ts', 499)]);
  assert.equal(mixed.highRiskChangedLines, 1);
  assert.ok(!mixed.reasons.some((r) => r.signal === 'large-change'));
  assert.ok(assess('', [change('packages/api/src/services/AuthService.ts', 500)]).reasons.some((r) => r.signal === 'large-change'));
});

test('AI review, confidential metadata, and declaration signals are counted once', () => {
  const policy = neutralPolicy();
  policy.application.dataClassification = 'confidential';
  const result = assess('- AI assistance used: significant\n- AI-generated code manually reviewed: no\n- New dependency introduced: yes',
    [change('package.json'), change('packages/api/package.json')], policy);
  assert.equal(result.score, 8);
  assert.equal(result.reasons.filter((r) => r.signal === 'new-dependency').length, 1);
  assert.ok(result.reasons.some((r) => r.signal === 'unreviewed-ai'));
});

test('template placeholders remain unknown, malformed values are recorded, duplicate fields fail', () => {
  const parsed = parseDeclarations('- AI assistance used: <!-- none | low | significant | predominant -->\n- Authentication or authorization changed: perhaps');
  assert.equal(parsed.values.ai, 'unknown');
  assert.equal(parsed.values.auth, 'unknown');
  assert.ok(parsed.issues.some((issue) => issue.status === 'unrecognized'));
  assert.throws(() => parseDeclarations('- Authentication or authorization changed: no\n- Authentication or authorization changed: yes'), /Duplicate/);
});

test('numstat preserves rename/deletion/binary paths and arbitrary punctuation as data', () => {
  const unusual = 'packages/api/src/secrets/odd,\t\n${notAnExpression}.ts';
  const changes = parseNumstat(Buffer.from(`1\t2\t${unusual}\0` +
    '0\t0\t\0packages/api/src/services/AuthService.ts\0ordinary.ts\0' +
    '-\t-\tbinary.dat\0' + '0\t3\tdeleted.ts\0'));
  assert.equal(changes[0].paths[0], unusual);
  assert.deepEqual(changes[1].paths, ['packages/api/src/services/AuthService.ts', 'ordinary.ts']);
  assert.equal(changes[2].binary, true);
  assert.equal(changes[3].deleted, 3);
  assert.equal(assess('', changes).mandatory, true);
  for (const invalid of ['1\t2\tfile.ts', '0\t0\t\0only-old\0', '-\t1\tx\0', 'garbage\0']) {
    assert.throws(() => parseNumstat(invalid));
  }
  assert.throws(() => parseNumstat(Buffer.from([0xff, 0])));
});

test('bad policy and missing event metadata fail explicitly', () => {
  for (const mutate of [
    (p) => { delete p.application.internetFacing; },
    (p) => { p.application.dataClassification = 'unknown'; },
    (p) => { p.thresholds.mandatory = 5; },
    (p) => { p.scores['new-api'] = -4; },
    (p) => { delete p.scores['large-change']; },
    (p) => { p.paths['new-api'] = ['[']; },
    (p) => { p.mandatorySignals = ['unknown-signal']; },
    (p) => { p.requiredLabels = [null]; },
  ]) {
    const policy = neutralPolicy();
    mutate(policy);
    assert.throws(() => validatePolicy(policy));
  }
  const input = event();
  input.pull_request.head.sha = '--help';
  assert.throws(() => assessPullRequest(input, [], neutralPolicy()), /SHA/);
  delete input.repository.id;
  assert.throws(() => assessPullRequest(input, [], neutralPolicy()), /repository identity/);
});

test('invalid outputs fail and summary escapes untrusted Markdown/newlines', () => {
  assert.throws(() => validateResult({ score: 2, mandatory: false, decision: 'faa-mandatory' }), /Inconsistent/);
  assert.throws(() => validateResult({ score: '2', mandatory: false, decision: 'sast-sca-only' }), /Invalid/);
  const result = assess('- Authentication or authorization changed: yes');
  result.reasons[0].evidence = ['<img>|[link](https://example.invalid)\n## injected'];
  const summary = formatSummary(result);
  assert.ok(!summary.includes('<img>'));
  assert.ok(!summary.includes('[link]'));
  assert.ok(!summary.includes('\n## injected'));
  assert.match(summary, /No FAA scan or FoD import was performed/);
});

test('Git-backed adapter uses the selected policy, merge-base diff, and emits outputs only on success', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'faa-risk-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, 'source');
  await mkdir(source);
  const git = (...args) => execFileSync('git', ['-C', source, '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' }).trim();
  const write = async (path, value) => {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), value);
  };
  const commit = () => {
    git('add', '--all');
    git('-c', 'user.name=FAA test', '-c', 'user.email=faa-test@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + join(temp, 'no-hooks'),
      'commit', '-m', 'Test fixture\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>');
    return git('rev-parse', 'HEAD');
  };
  git('init', '--template=');
  await write('packages/api/src/services/AuthService.ts', 'export const original = true;\n');
  await write('removed.ts', 'one\ntwo\nthree\n');
  const baseSha = commit();
  await rename(join(source, 'packages/api/src/services/AuthService.ts'), join(source, 'renamed, file.ts'));
  await rm(join(source, 'removed.ts'));
  await write('binary.dat', Buffer.from([0, 1, 0, 2]));
  await write('.github/faa-policy.json', '{"scores":{}}');
  await write('.github/scripts/faa-risk-adapter.mjs', 'throw new Error("PR code must never execute");');
  const headSha = commit();
  const input = event('- Authentication or authorization changed: no');
  input.pull_request.base.sha = baseSha;
  input.pull_request.head.sha = headSha;
  input.pull_request.head.repo = { id: input.repository.id };
  const eventPath = join(temp, 'event.json');
  await writeFile(eventPath, JSON.stringify(input));
  const outputDir = join(temp, 'out');
  const env = { GITHUB_OUTPUT: join(temp, 'outputs'), GITHUB_STEP_SUMMARY: join(temp, 'summary'),
    GITHUB_RUN_ID: '99' };
  const result = await runAdapter({ eventPath, sourceDir: source, outputDir, env });
  assert.equal(result.score, 9);
  assert.equal(result.decision, 'faa-mandatory');
  assert.equal(result.diffBaseSha, baseSha);
  assert.equal(result.headSha, headSha);
  assert.equal(result.policySha256.length, 64);
  assert.ok(result.reasons.some((r) => r.evidence.includes('packages/api/src/services/AuthService.ts')));
  assert.ok(result.assessmentId.endsWith(':99:1'));
  assert.match(await readFile(env.GITHUB_OUTPUT, 'utf8'), /score=9\nmandatory=true\ndecision=faa-mandatory\ndo_faa=true\n/);
  assert.ok((await readFile(env.GITHUB_OUTPUT, 'utf8')).includes(`change_range=${baseSha}..${headSha}\n`));
  assert.equal(JSON.parse(await readFile(join(outputDir, 'faa-risk-result.json'), 'utf8')).repositoryId, 123);
  const customPolicy = neutralPolicy();
  customPolicy.mandatorySignals = [];
  customPolicy.thresholds = { recommended: 50, mandatory: 100 };
  const customPolicyPath = join(temp, 'custom-policy.json');
  await writeFile(customPolicyPath, JSON.stringify(customPolicy));
  const customResult = await runAdapter({
    eventPath, sourceDir: source, outputDir: join(temp, 'custom-policy-output'),
    policyPath: customPolicyPath, env: {},
  });
  assert.equal(customResult.doFaa, false);
  const customCli = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/faa-risk-adapter.mjs', import.meta.url)),
    '--event', eventPath, '--source', source, '--policy', customPolicyPath,
    '--output', join(temp, 'custom-cli'),
  ], { encoding: 'utf8' });
  assert.ifError(customCli.error);
  assert.equal(customCli.status, 0, customCli.stderr);
  assert.equal(JSON.parse(await readFile(join(temp, 'custom-cli', 'faa-risk-result.json'), 'utf8')).doFaa, false);
  input.pull_request.head.repo.id = 456;
  await writeFile(eventPath, JSON.stringify(input));
  const fork = await runAdapter({ eventPath, sourceDir: source, outputDir: join(temp, 'fork'), env: {} });
  assert.equal(fork.doFaa, false);
  assert.equal(fork.faaExecution.status, 'skipped-fork');
  input.pull_request.head.repo.id = 123;
  input.pull_request.base.sha = headSha;
  input.pull_request.labels = [{ name: 'faa-required' }];
  await writeFile(eventPath, JSON.stringify(input));
  const empty = await runAdapter({ eventPath, sourceDir: source, outputDir: join(temp, 'empty'), env: {} });
  assert.equal(empty.doFaa, false);
  assert.equal(empty.mandatory, true);
  assert.equal(empty.faaExecution.status, 'skipped-no-changes');
  input.pull_request.labels = [];
  input.pull_request.base.sha = 'd'.repeat(40);
  await writeFile(eventPath, JSON.stringify(input));
  await assert.rejects(runAdapter({
    eventPath, sourceDir: source, outputDir: join(temp, 'missing-base'), env: {},
  }));
  input.pull_request.base.sha = baseSha;
  input.pull_request.head.sha = 'c'.repeat(40);
  await writeFile(eventPath, JSON.stringify(input));
  const failedOutput = join(temp, 'failed-output');
  await assert.rejects(runAdapter({
    eventPath, sourceDir: source, outputDir: join(temp, 'failed'), env: { GITHUB_OUTPUT: failedOutput },
  }), /does not match PR head/);
  await assert.rejects(readFile(failedOutput), { code: 'ENOENT' });
  const failure = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/faa-risk-adapter.mjs', import.meta.url)),
    '--event', eventPath, '--source', source, '--output', join(temp, 'cli-failure'),
  ], { encoding: 'utf8' });
  assert.ifError(failure.error);
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /FAA assessment failed/);
  await rm(join(source, 'renamed, file.ts'));
  input.pull_request.base.sha = headSha;
  input.pull_request.head.sha = commit();
  input.pull_request.labels = [{ name: 'faa-required' }];
  await writeFile(eventPath, JSON.stringify(input));
  const deleted = await runAdapter({ eventPath, sourceDir: source, outputDir: join(temp, 'deleted'), env: {} });
  assert.equal(deleted.mandatory, true);
  assert.equal(deleted.doFaa, false);
  assert.equal(deleted.faaExecution.status, 'skipped-no-changes');
});
