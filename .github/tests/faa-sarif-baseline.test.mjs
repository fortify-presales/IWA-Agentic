import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { findPrevious, restorePrevious, saveCurrent } from '../scripts/faa-sarif-baseline.mjs';

const sarif = () => ({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'Fortify Agentic Analyzer' } }, results: [] }],
});

function logger() {
  const outputs = {};
  const messages = [];
  const warnings = [];
  return {
    outputs, messages, warnings,
    setOutput: (key, value) => { outputs[key] = value; },
    info: (message) => messages.push(message),
    warning: (message) => warnings.push(message),
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'faa-baseline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  await mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'FAA baseline tests');
  const commits = [];
  for (let i = 0; i < 3; i++) {
    await writeFile(join(repo, 'source.txt'), `revision ${i}\n`);
    git('add', 'source.txt');
    git('commit', '-qm', `revision ${i}`);
    commits.push(git('rev-parse', 'HEAD'));
  }
  const [from, previous, to] = commits;
  git('checkout', '-qb', 'unrelated', from);
  await writeFile(join(repo, 'other.txt'), 'unrelated branch\n');
  git('add', 'other.txt');
  git('commit', '-qm', 'unrelated');
  const unrelated = git('rev-parse', 'HEAD');
  git('checkout', '-q', to);
  const context = {
    eventName: 'pull_request',
    repo: { owner: 'example', repo: 'app' },
    runId: 1000,
    payload: {
      repository: { id: 123 },
      pull_request: {
        number: 7,
        head: { sha: to, ref: 'feature/faa', repo: { id: 123 } },
        base: { ref: 'main', repo: { id: 123 } },
      },
    },
  };
  const env = {
    FAA_PLATFORM: 'fod',
    FAA_CHANGE_RANGE: `${from}..${to}`,
    GITHUB_WORKFLOW_REF: 'example/app/.github/workflows/fod.yml@refs/pull/7/merge',
    GITHUB_WORKSPACE: repo,
    GITHUB_RUN_ATTEMPT: '2',
    RUNNER_TEMP: root,
  };
  const outputDir = join(root, 'faa-output');
  const previousDir = join(root, 'faa-previous');
  await mkdir(outputDir);
  await mkdir(previousDir);
  const metadata = {
    version: 1, repository: 'example/app', repositoryId: 123,
    workflow: 'example/app/.github/workflows/fod.yml', platform: 'fod',
    pr: 7, headRef: 'feature/faa', baseRef: 'main', from, to: previous,
    runId: 900, runAttempt: 1,
  };
  return { context, env, from, previous, to, unrelated, metadata, outputDir, previousDir };
}

function name(metadata) {
  return `faa-sarif-${metadata.platform}-pr${metadata.pr}-${metadata.from}-${metadata.to}-${metadata.runId}-${metadata.runAttempt}`;
}

function candidate(f, overrides = {}) {
  return {
    id: 900, run_number: 19, run_attempt: 1, workflow_id: 50,
    conclusion: 'success', event: 'pull_request', head_branch: 'feature/faa',
    head_sha: f.previous, head_repository: { id: 123 },
    pull_requests: [structuredClone(f.context.payload.pull_request)],
    ...overrides,
  };
}

function api(runs, artifacts = {}) {
  const actions = {
    getWorkflowRun: async () => ({ data: { workflow_id: 50, run_number: 20 } }),
    listWorkflowRuns: () => {},
    listWorkflowRunArtifacts: () => {},
  };
  const paginate = async (_method, options) => artifacts[options.run_id] ?? [];
  paginate.iterator = async function* (_method, options) {
    assert.equal(options.workflow_id, 50);
    assert.equal(options.status, 'success');
    assert.equal(options.branch, 'feature/faa');
    for (const run of runs) yield { data: [run] };
  };
  return { rest: { actions }, paginate };
}

test('discovery selects only a successful earlier same-PR/workflow/repository ancestor with a matching artifact', async (t) => {
  const f = await fixture(t);
  const foreignPr = structuredClone(f.context.payload.pull_request);
  foreignPr.number = 8;
  const retargeted = structuredClone(f.context.payload.pull_request);
  retargeted.base.ref = 'release';
  const overrides = [
    { id: 1000, run_number: 18 }, // Exclude the current run even on a retry.
    { run_number: 21 },
    { conclusion: 'failure' },
    { event: 'push' },
    { workflow_id: 51 },
    { head_branch: 'another-branch' },
    { head_repository: { id: 456 } },
    { pull_requests: [foreignPr] },
    { pull_requests: [retargeted] },
    { pull_requests: [] },
    { head_sha: f.unrelated },
    { head_sha: 'd'.repeat(40) }, // An abandoned force-push head may not be fetched.
  ];
  const runs = overrides.map((override, index) => candidate(f, { id: 950 + index, ...override }));
  const artifacts = Object.fromEntries(runs.map((run) => [
    run.id, [{ name: name({ ...f.metadata, to: run.head_sha, runId: run.id }), expired: false }],
  ]));
  runs.push(candidate(f, { id: 910 }), candidate(f, { id: 911 }), candidate(f, { id: 912 }), candidate(f));
  artifacts[910] = [{ name: name({ ...f.metadata, runId: 910 }), expired: true }];
  artifacts[911] = [{ name: name({ ...f.metadata, runId: 911, platform: 'ssc' }), expired: false }];
  artifacts[912] = [{ name: name({ ...f.metadata, runId: 912, from: 'a'.repeat(40) }), expired: false }];
  artifacts[900] = [{ name: name(f.metadata), expired: false }];
  const core = logger();
  await findPrevious({ ...f, core, github: api(runs, artifacts) });
  assert.equal(core.outputs.run_id, 900);
  assert.equal(core.outputs.artifact_name, name(f.metadata));
  assert.deepEqual(JSON.parse(core.outputs.metadata), f.metadata);
});

test('first run removes stale temporary outputs and continues without a synthetic baseline', async (t) => {
  const f = await fixture(t);
  const stale = [
    join(f.previousDir, 'faa.sarif'), join(f.previousDir, 'previous-faa.sarif'),
    join(f.previousDir, 'faa-baseline.json'), join(f.outputDir, 'faa.sarif'),
    join(f.outputDir, 'faa.sarif.md'), join(f.outputDir, 'faa-baseline.json'),
  ];
  for (const file of stale) await writeFile(file, 'stale');
  const core = logger();
  await findPrevious({ ...f, core, github: api([]) });
  assert.equal(core.outputs.run_id, '');
  assert.ok(core.messages.some((message) => message.includes('No previous eligible')));
  for (const file of stale) await assert.rejects(readFile(file), { code: 'ENOENT' });
});

test('GitHub API failures warn without hiding unexpected discovery errors', async (t) => {
  const f = await fixture(t);
  const github = api([]);
  github.rest.actions.getWorkflowRun = async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); };
  const core = logger();
  await findPrevious({ ...f, github, core });
  assert.ok(core.warnings[0].includes('HTTP 403'));
  assert.equal(core.outputs.run_id, '');
  github.rest.actions.getWorkflowRun = async () => { throw new Error('unexpected'); };
  await assert.rejects(findPrevious({ ...f, github, core }), /unexpected/);
});

test('restore accepts a valid zero-finding FAA report and exposes its deterministic path', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.previousDir, 'faa.sarif'), JSON.stringify(sarif()));
  await writeFile(join(f.previousDir, 'faa-baseline.json'), JSON.stringify(f.metadata));
  const core = logger();
  await restorePrevious({
    ...f, core,
    env: { ...f.env, FAA_BASELINE_METADATA: JSON.stringify(f.metadata), FAA_BASELINE_DOWNLOAD_OUTCOME: 'success' },
  });
  assert.equal(core.outputs.path, join(f.previousDir, 'previous-faa.sarif'));
  assert.deepEqual(JSON.parse(await readFile(core.outputs.path, 'utf8')), sarif());
  assert.equal(core.warnings.length, 0);
});

test('download failure, empty/malformed SARIF and mismatched provenance warn and omit the baseline', async (t) => {
  const f = await fixture(t);
  const cases = [
    { outcome: 'failure' },
    { missingReport: true },
    { missingMetadata: true },
    { report: '' },
    { report: 'not JSON' },
    { report: '{"version":"2.1.0","runs":[]}' },
    { report: JSON.stringify({ ...sarif(), version: '1.0' }) },
    { report: JSON.stringify({ version: '2.1.0', runs: [{ tool: sarif().runs[0].tool, results: [null] }] }) },
    ...['pr', 'platform', 'from', 'to', 'runId', 'runAttempt', 'headRef', 'workflow'].map((key) => ({
      report: JSON.stringify(sarif()), metadata: { ...f.metadata, [key]: 'wrong' },
    })),
  ];
  for (const entry of cases) {
    await writeFile(join(f.previousDir, 'faa.sarif'), entry.report ?? JSON.stringify(sarif()));
    await writeFile(join(f.previousDir, 'faa-baseline.json'), JSON.stringify(entry.metadata ?? f.metadata));
    if (entry.missingReport) await rm(join(f.previousDir, 'faa.sarif'));
    if (entry.missingMetadata) await rm(join(f.previousDir, 'faa-baseline.json'));
    const core = logger();
    await restorePrevious({
      ...f, core,
      env: {
        ...f.env, FAA_BASELINE_METADATA: JSON.stringify(f.metadata),
        FAA_BASELINE_DOWNLOAD_OUTCOME: entry.outcome ?? 'success',
      },
    });
    assert.equal(core.outputs.path, '');
    assert.equal(core.warnings.length, 1);
  }
});

test('saving requires a usable current report and records source, PR, workflow and attempt metadata', async (t) => {
  const f = await fixture(t);
  const core = logger();
  await assert.rejects(saveCurrent({ ...f, core }), { code: 'ENOENT' });
  for (const text of ['', '{}', JSON.stringify({ version: '2.1.0', runs: [{ results: [] }] })]) {
    await writeFile(join(f.outputDir, 'faa.sarif'), text);
    await assert.rejects(saveCurrent({ ...f, core }), /JSON|SARIF/);
    assert.equal(core.outputs.artifact_name, undefined);
  }
  await writeFile(join(f.outputDir, 'faa.sarif'), JSON.stringify(sarif()));
  await saveCurrent({ ...f, core });
  const metadata = JSON.parse(await readFile(join(f.outputDir, 'faa-baseline.json'), 'utf8'));
  assert.deepEqual(metadata, { ...f.metadata, to: f.to, runId: 1000, runAttempt: 2 });
  assert.equal(core.outputs.artifact_name, name(metadata));
});

test('a saved successful FAA report round-trips through discovery and restore on the next PR head', async (t) => {
  const f = await fixture(t);
  const priorContext = structuredClone(f.context);
  priorContext.runId = 900;
  priorContext.payload.pull_request.head.sha = f.previous;
  const priorEnv = { ...f.env, FAA_CHANGE_RANGE: `${f.from}..${f.previous}`, GITHUB_RUN_ATTEMPT: '1' };
  await writeFile(join(f.outputDir, 'faa.sarif'), JSON.stringify(sarif()));
  const prior = logger();
  await saveCurrent({ context: priorContext, env: priorEnv, core: prior });
  const files = await Promise.all(['faa.sarif', 'faa-baseline.json'].map(async (file) =>
    [file, await readFile(join(f.outputDir, file))]));
  const discovered = logger();
  await findPrevious({
    ...f, core: discovered,
    github: api([candidate(f)], {
      900: [{ name: prior.outputs.artifact_name, expired: false }],
    }),
  });
  for (const [file, content] of files) await writeFile(join(f.previousDir, file), content);
  const restored = logger();
  await restorePrevious({
    ...f, core: restored,
    env: {
      ...f.env, FAA_BASELINE_METADATA: discovered.outputs.metadata,
      FAA_BASELINE_DOWNLOAD_OUTCOME: 'success',
    },
  });
  assert.equal(restored.outputs.path, join(f.previousDir, 'previous-faa.sarif'));
  assert.equal(restored.warnings.length, 0);
});
