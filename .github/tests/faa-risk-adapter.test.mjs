import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assess, runAdapter, validatePolicy } from '../scripts/faa-risk-adapter.mjs';

const policy = JSON.parse(await readFile(new URL('../faa-policy.json', import.meta.url), 'utf8'));
const pr = (overrides = {}) => ({ labels: [], body: '', paths: [], changedLines: 0, ...overrides });

test('repository policy is valid', () => {
  validatePolicy(policy);
});

test('documentation-only change is below threshold', () => {
  const result = assess(policy, pr({ paths: ['README.md'], changedLines: 10 }));
  assert.equal(result.score, 0);
  assert.equal(result.selected, false);
});

test('label, path, declaration and size rules each add points', () => {
  assert.equal(assess(policy, pr({ labels: ['faa-required'] })).selected, true);
  assert.equal(assess(policy, pr({ paths: ['packages/api/src/utils/jwt.ts'] })).selected, true);
  const declared = assess(policy, pr({
    body: '<!-- - AI-generated code manually reviewed: no -->\n- AI assistance used: Predominant\n- AI-generated code manually reviewed: no',
  }));
  assert.deepEqual(declared.matched.map((r) => r.points), [2, 3]);
  assert.equal(declared.selected, true);
  assert.equal(assess(policy, pr({ changedLines: 500 })).score, 2);
});

test('rules need exactly one condition', () => {
  assert.throws(() => validatePolicy({ threshold: 1, rules: [{ name: 'x', points: 1 }] }), /exactly one/);
  assert.throws(() => validatePolicy({ threshold: 1, rules: [{ name: 'x', points: 1, label: 'a', paths: ['b'] }] }), /exactly one/);
});

test('runAdapter computes the merge-base range and skips forks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'faa-risk-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args]).toString().trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    await writeFile(join(dir, 'a.txt'), 'a\n');
    git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    await writeFile(join(dir, 'secret-store.ts'), 'x\n');
    git('add', '.'); git('commit', '-qm', 'head');
    const head = git('rev-parse', 'HEAD');
    const run = async (headRepoId) => {
      const eventPath = join(dir, `event-${headRepoId}.json`);
      await writeFile(eventPath, JSON.stringify({ pull_request: {
        number: 7, body: '', labels: [], base: { sha: base, repo: { id: 1 } }, head: { sha: head, repo: { id: headRepoId } },
      } }));
      return runAdapter({ eventPath, sourceDir: dir, outputDir: join(dir, 'out'), policyPath: new URL('../faa-policy.json', import.meta.url), env: {} });
    };
    const same = await run(1);
    assert.equal(same.doFaa, true);
    assert.equal(same.changeRange, `${base}..${head}`);
    const fork = await run(2);
    assert.equal(fork.doFaa, false);
    assert.equal(fork.skipReason, 'fork');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
