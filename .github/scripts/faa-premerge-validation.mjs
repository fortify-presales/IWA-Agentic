import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assessPullRequest, runAdapter } from './faa-risk-adapter.mjs';

const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function main() {
  requireValue(process.env.GITHUB_REPOSITORY === 'fortify-presales/IWA-Agentic'
    && process.env.GITHUB_REF === 'refs/heads/feature/020-faa-risk-pilot',
  'Pre-merge validation is restricted to the approved repository and branch');
  requireValue(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ''), 'Invalid dispatched SHA');
  requireValue(process.env.GITHUB_WORKSPACE && process.env.FAA_VALIDATION_DIR && process.env.GH_TOKEN,
    'Missing pre-merge validation configuration');

  const pr = JSON.parse(execFileSync('gh', ['api', 'repos/fortify-presales/IWA-Agentic/pulls/25'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  requireValue(pr.state === 'open' && pr.draft === false && pr.base?.ref === 'main'
    && pr.head?.ref === 'feature/020-faa-risk-pilot', 'PR 25 is not an open, ready pilot PR into main');
  requireValue(pr.head.sha === process.env.GITHUB_SHA, 'Dispatch does not match the current PR head');
  requireValue(/^[a-f0-9]{40}$/.test(pr.base.sha ?? '') && process.env.FAA_BASE_SHA === pr.base.sha,
    'Pilot scan base must equal the current PR base SHA');
  const event = { repository: pr.base.repo, pull_request: pr };
  const policy = JSON.parse(await readFile(new URL('../faa-policy.json', import.meta.url), 'utf8'));
  const scenario = (body, labels = []) => assessPullRequest({
    ...event, pull_request: { ...pr, body, labels },
  }, [], policy);
  const neutral = scenario('');
  assert.equal(neutral.score, 4);
  assert.equal(neutral.decision, 'sast-sca-only');
  const ai = scenario('- AI assistance used: predominant\n- AI-generated code manually reviewed: yes');
  assert.equal(ai.score, 6);
  assert.equal(ai.decision, 'faa-recommended');
  const auth = scenario('- Authentication or authorization changed: yes');
  assert.equal(auth.score, 9);
  assert.equal(auth.decision, 'faa-mandatory');
  assert.equal(scenario('', [{ name: 'faa-required' }]).decision, 'faa-mandatory');
  console.log('Controlled risk scenarios passed: neutral=4, predominant AI=6, authentication=9, required label=mandatory.');

  const validationDir = resolve(process.env.FAA_VALIDATION_DIR);
  await mkdir(validationDir, { recursive: true });
  const eventPath = join(validationDir, 'event.json');
  await writeFile(eventPath, JSON.stringify(event));
  const result = await runAdapter({
    eventPath, sourceDir: resolve(process.env.GITHUB_WORKSPACE), outputDir: join(validationDir, 'evidence'),
  });
  requireValue(result.headSha === pr.head.sha && result.baseSha === pr.base.sha,
    'Assessment evidence does not match PR revisions');
  console.log(`PR 25 pre-merge assessment: score=${result.score}, mandatory=${result.mandatory}, decision=${result.decision}.`);
  console.log('Branch controls are under review; this is not a trusted-base workflow run.');
}

try {
  await main();
} catch (error) {
  console.error(`Pre-merge validation failed: ${JSON.stringify(error.message)}`);
  process.exitCode = 1;
}
