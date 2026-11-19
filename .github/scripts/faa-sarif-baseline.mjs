import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sha = /^[a-f0-9]{40}$/;

class InvalidBaseline extends Error {}

function scope(context, env) {
  const pr = context.payload.pull_request;
  const [from, to, extra] = (env.FAA_CHANGE_RANGE ?? '').split('..');
  if (context.eventName !== 'pull_request' || !pr || !sha.test(from) || !sha.test(to) ||
      from === to || extra !== undefined || to !== pr.head.sha ||
      !['fod', 'ssc'].includes(env.FAA_PLATFORM)) {
    throw new Error('FAA baseline requires a PR, platform and exact merge-base..head range');
  }
  return {
    version: 1,
    repository: `${context.repo.owner}/${context.repo.repo}`,
    repositoryId: context.payload.repository.id,
    workflow: env.GITHUB_WORKFLOW_REF.split('@')[0],
    platform: env.FAA_PLATFORM,
    pr: pr.number,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    from, to,
    runId: context.runId,
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
  };
}

function paths(env) {
  return {
    previousDir: join(env.RUNNER_TEMP, 'faa-previous'),
    outputDir: join(env.RUNNER_TEMP, 'faa-output'),
  };
}

function artifactName(metadata) {
  return `faa-sarif-${metadata.platform}-pr${metadata.pr}-${metadata.from}-${metadata.to}-${metadata.runId}-${metadata.runAttempt}`;
}

async function readJson(file) {
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new InvalidBaseline('File is empty or is not valid JSON');
  }
}

async function validateSarif(file) {
  const sarif = await readJson(file);
  if (sarif?.version !== '2.1.0' || !Array.isArray(sarif.runs) || sarif.runs.length === 0 ||
      sarif.runs.some((run) => typeof run?.tool?.driver?.name !== 'string' ||
        !run.tool.driver.name || !Array.isArray(run.results) ||
        run.results.some((result) => !result || typeof result !== 'object' ||
          (typeof result.message?.text !== 'string' && typeof result.message?.markdown !== 'string')))) {
    throw new InvalidBaseline('File is not a usable SARIF 2.1.0 report');
  }
}

function isAncestor(from, to, cwd, core) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', from, to], {
    cwd, encoding: 'utf8', timeout: 120_000,
  });
  if (result.error) throw result.error;
  // An old force-push head may no longer be present in the checkout.
  if (result.status === 1) return false;
  if (result.status === 128) {
    core.warning(`Unable to check ancestry of previous FAA commit ${from} (Git exit 128); skipping this candidate`);
    return false;
  }
  if (result.status !== 0) throw new Error(`Git ancestry check failed (exit ${result.status})`);
  return true;
}

export async function findPrevious({ github, context, core, env = process.env }) {
  const current = scope(context, env);
  const { previousDir, outputDir } = paths(env);
  await mkdir(previousDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  for (const file of [
    join(previousDir, 'faa.sarif'), join(previousDir, 'faa-baseline.json'),
    join(previousDir, 'previous-faa.sarif'), join(outputDir, 'faa.sarif'),
    join(outputDir, 'faa.sarif.md'), join(outputDir, 'faa-baseline.json'),
  ]) await rm(file, { force: true });
  core.info(`FAA differential FROM: ${current.from}`);
  core.info(`FAA differential TO: ${current.to}`);
  core.info(`FAA FPR path: not used; existing ${current.platform.toUpperCase()} findings are supplied natively`);
  core.info(`FAA current SARIF: ${join(outputDir, 'faa.sarif')}`);
  core.setOutput('run_id', '');

  try {
    const { data: run } = await github.rest.actions.getWorkflowRun({
      ...context.repo, run_id: current.runId,
    });
    for await (const page of github.paginate.iterator(github.rest.actions.listWorkflowRuns, {
      ...context.repo, workflow_id: run.workflow_id, branch: current.headRef,
      event: 'pull_request', status: 'success', per_page: 100,
    })) {
      for (const candidate of page.data) {
        if (candidate.id === current.runId || candidate.run_number >= run.run_number ||
            candidate.conclusion !== 'success' || candidate.event !== 'pull_request' ||
            candidate.workflow_id !== run.workflow_id || candidate.head_branch !== current.headRef ||
            candidate.head_repository?.id !== current.repositoryId || !sha.test(candidate.head_sha) ||
            !candidate.pull_requests?.some((pr) => pr.number === current.pr &&
              pr.head?.ref === current.headRef && pr.head.repo?.id === current.repositoryId &&
              pr.base?.ref === current.baseRef && pr.base.repo?.id === current.repositoryId) ||
            !isAncestor(candidate.head_sha, current.to, env.GITHUB_WORKSPACE, core)) continue;
        const expected = {
          ...current, to: candidate.head_sha, runId: candidate.id, runAttempt: candidate.run_attempt,
        };
        const name = artifactName(expected);
        const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
          ...context.repo, run_id: candidate.id, per_page: 100,
        });
        if (!artifacts.some((artifact) => artifact.name === name && !artifact.expired)) continue;
        core.setOutput('run_id', candidate.id);
        core.setOutput('artifact_name', name);
        core.setOutput('metadata', JSON.stringify(expected));
        core.info(`Selected previous FAA artifact ${name} from run ${candidate.id}`);
        return;
      }
    }
  } catch (error) {
    if (!Number.isInteger(error.status)) throw error;
    core.warning(`Unable to discover previous FAA artifacts (GitHub HTTP ${error.status}); continuing without a baseline`);
  }
  core.info('No previous eligible FAA SARIF baseline found; FAA previous SARIF available: false');
}

export async function restorePrevious({ context, core, env = process.env }) {
  core.setOutput('path', '');
  if (env.FAA_BASELINE_DOWNLOAD_OUTCOME !== 'success') {
    core.warning('Previous FAA artifact download failed; FAA previous SARIF available: false');
    return;
  }
  const current = scope(context, env);
  const expected = JSON.parse(env.FAA_BASELINE_METADATA);
  const { previousDir } = paths(env);
  const source = join(previousDir, 'faa.sarif');
  try {
    const metadata = await readJson(join(previousDir, 'faa-baseline.json'));
    if (Object.entries(expected).some(([key, value]) => metadata?.[key] !== value) ||
        Object.entries(current).some(([key, value]) =>
          !['to', 'runId', 'runAttempt'].includes(key) && expected[key] !== value)) {
      throw new InvalidBaseline('Previous FAA metadata does not match the selected PR baseline');
    }
    await validateSarif(source);
  } catch (error) {
    if (!(error instanceof InvalidBaseline) &&
        !['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    core.warning(`Ignoring unusable previous FAA baseline: ${error.message}; FAA previous SARIF available: false`);
    return;
  }
  const previous = join(previousDir, 'previous-faa.sarif');
  await rename(source, previous);
  core.setOutput('path', previous);
  core.info(`FAA previous SARIF available: true; path: ${previous}`);
}

export async function saveCurrent({ context, core, env = process.env }) {
  const current = scope(context, env);
  const { outputDir } = paths(env);
  await validateSarif(join(outputDir, 'faa.sarif'));
  await writeFile(join(outputDir, 'faa-baseline.json'), `${JSON.stringify(current, null, 2)}\n`);
  const name = artifactName(current);
  core.setOutput('artifact_name', name);
  core.info(`Validated FAA SARIF; uploading baseline artifact: ${name}`);
}
