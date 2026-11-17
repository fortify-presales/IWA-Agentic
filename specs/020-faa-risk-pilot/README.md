# FAA risk pilot runbook

## What is implemented

One dependency-free Node.js ES module assesses PR risk, writes JSON audit evidence and a Markdown
summary, and publishes GitHub outputs. The workflow evaluates non-draft PRs into `main` on
creation, updates, body edits, readiness, and label changes. The assessment workflow never runs FAA,
imports FoD results, or enforces production policy. Existing SAST/SCA workflows remain independent.
A separate manual-only [differential smoke test](../../.github/workflows/faa-smoke-test.yml) can run
FAA 26.4.0 against changes on `main` or the explicitly approved `feature/020-faa-risk-pilot`
branch. It has no FoD integration.

## Prerequisites and validation

Node.js 20+ and Git are sufficient. No npm install, fcli, FAA, credentials, or application build
is needed for assessment.

From the repository root:

```powershell
node --test .github\tests\faa-risk-adapter.test.mjs
git --no-pager diff --check
```

For a local assessment, provide a saved GitHub PR event and a separate Git checkout whose HEAD is
the event's head SHA and whose history contains the base SHA. Execute trusted controls, not a
script from that source checkout:

```powershell
node .github\scripts\faa-risk-adapter.mjs --event C:\temp\pr-event.json --source C:\temp\pr-source --output C:\temp\faa-evidence
```

The policy path is fixed relative to the executed module, not selectable by the PR event.
Required event fields are `repository.id`, `repository.full_name`, and
`pull_request.{number,draft,body,labels,base.sha,base.repo.id,head.sha}`.
The repository name must match the policy, and `base.repo.id` must match `repository.id`.
Drafts fail local invocation explicitly; automatic assessment skips drafts.

Outputs:

- `faa-risk-result.json`: policy version/hash, repository identity, SHAs, assessment ID, scoring
  reasons/evidence, static metadata provenance, declaration issues/conflicts, unevaluated signals,
  and explicit FAA execution status.
- `faa-risk-summary.md`: bounded summary with full evidence retained in JSON.
- `GITHUB_OUTPUT`: `score`, `mandatory`, `decision`, only after successful assessment.

The recorded control SHA is the actual checkout containing the executing module. Local uncommitted
changes are not proof of a protected revision; CI additionally verifies that control SHA equals the
event's base SHA. The policy hash identifies the exact policy bytes.

## Trust and activation

The `pull_request_target` workflow executes only controls from the base SHA. A separate, credential-free
head checkout is data for Git; it is never imported, built, installed, or executed. Git external diffs
and text conversion are disabled. The workflow has only `contents: read`, no Fortify secrets, no PR
write permission, and does not publish to GitHub code scanning.

Merge the tooling through normal review before evaluating later PRs: PR changes to workflow/scorer/
policy intentionally cannot assess themselves with modified controls. Manual dispatch of the
assessment workflow runs tests only, not a fabricated PR assessment. The GitHub workflows must still be validated after
merge; local tests do not establish that a hosted run succeeded.

Current action major tags follow repository conventions. Immutable action pins, actual CODEOWNERS,
and protected-branch review rules must be confirmed before treating this as an enforced security control.
The initial workflow retains artifacts for 14 days; confirm retention/access policy before rollout.
In public repositories, summaries/artifacts may be accessible to others: assessment evidence contains paths and
declarations, never source contents or secrets. Do not use this pilot to collect confidential metadata.

## Policy and interpretation

[The policy](../../.github/faa-policy.json) is audit-only. Its tier-2, internet-facing, internal-data
classification is an explicit **pilot assumption**, not approved application metadata.
Internet exposure adds a standing +4; therefore documentation-only changes score 4, while a
predominantly AI-assisted change adds +2 and reaches the recommendation threshold. With neutral
test metadata, AI alone scores 2 and does not invoke FAA. A tier-1/restricted profile can reach
mandatory on metadata alone. Do not bypass these effects with undocumented special cases.

Patterns are case-insensitive JavaScript regular expressions against repository-relative Git paths.
Map the real services/middleware, not just directories named `auth`. Every logical signal scores once,
even with several paths and a declaration. API path changes are a conservative proxy for material
change: this milestone cannot determine whether an API was actually introduced or changed semantically.
An API signal plus internet exposure is mandatory. Auth/secrets/incident signals and `faa-required`
are mandatory regardless of total score. A numerical score of at least 9 also sets `mandatory=true`.

Executable lines are additions plus deletions from the merge-base-to-head diff, excluding configured
non-executable paths. Rename evidence includes both paths; pure renames add no lines. Binary paths
still trigger path/dependency signals but add no lines. `.gitattributes` can affect Git's binary
classification; line counts are a heuristic, not a content-aware security boundary.
Root `Src/` packaging copies are excluded from size only, not actual `packages/*/src/` files.
Lock-file changes still add dependency risk. Thresholds are inclusive: 500 lines in matched
high-risk files or 1500 executable lines overall. A positive sensitive-change declaration
conservatively treats all executable changes as high-risk because their location is unknown.

Leave PR template labels intact and replace HTML comments with an allowed value. Unanswered or
unrecognized answers remain `unknown` and appear in audit evidence; they are not verified `no`
answers. Duplicate declarations fail. Automated paths override `no`. A sensitive-data-processing
declaration is recorded but does not infer a trusted classification. Removing a label does not
override path/declaration evidence. Event labels/body are a snapshot; rerunning an old event does
not fetch current GitHub metadata, so use a new PR update/label event to reassess current state.

## Manual FAA differential smoke test

The registered runner `aws-ubuntu-runner-01` has labels `self-hosted`, `Linux`, `X64`, `fortify`, and
`faa`. The workflow selects those labels, not the runner name; any matching runner can receive it.
The runner must provide Git and FAA **26.4.0** on PATH, with its provider/model, service/license
access, and network access already configured for the runner service account. `actions/setup-node`
provisions Node 20; no application dependencies are installed. This workflow does not provision
fcli, log into FoD/SSC, or run a live self-test. It maps existing Actions settings explicitly
for FAA's license validation; settings consumed by `fortify/github-action` are not automatically
exported when running FAA directly.

### FoD or SSC licensing configuration

Set the repository variable `FAA_LICENSE_PLATFORM` to `fod` or `ssc` (lowercase). If unset or
empty, the workflow uses `fod`, matching the pilot preference. This selector does not change
the differential scan mode or introduce platform scans/imports.

Reuse these Actions settings; shared organization settings must grant this repository access:

| Backend | Actions setting | Type | FAA environment variable |
|---------|-----------------|------|--------------------------|
| FoD | `FOD_URL` | Variable | `FCLI_DEFAULT_FOD_URL` |
| FoD | `FOD_CLIENT_ID` | Secret | `FCLI_DEFAULT_FOD_CLIENT_ID` |
| FoD | `FOD_CLIENT_SECRET` | Secret | `FCLI_DEFAULT_FOD_CLIENT_SECRET` |
| SSC | `SSC_URL` | Variable | `FCLI_DEFAULT_SSC_URL` |
| SSC | `SSC_TOKEN` | Secret | `FCLI_DEFAULT_SSC_TOKEN` |

Keep credentials in secrets, not variables or workflow files. Only the selected backend is
provided to the FAA step; the helper also removes inherited `FCLI_DEFAULT_*` settings for the
other backend from FAA's child environment before both `-help` and `-scan`. FAA rejects mixed
FoD/SSC namespaces, so unused keys are removed entirely, not merely set to empty strings.
Missing selected settings and invalid selectors fail
before invoking FAA, naming the missing setting without printing its value.
Credentials are not command-line arguments or execution-record fields. The selector is recorded
as configuration, not proof that license validation or scanning succeeded.

If FAA still reports that license validation is required, validate the selected Fortify
configuration under the runner service account using `fortifyaa -license` before retrying.
Do not copy tokens or license-cache contents into logs, artifacts or this repository.

### Test the feature branch before merging the pilot

GitHub requires a `workflow_dispatch` workflow to exist on the default branch before it can be
dispatched on another ref. Register the dispatcher without merging the full pilot:

1. In a separate branch based on `main`, add only a harmless
   `.github/workflows/faa-smoke-test.yml` registration stub. It must declare `workflow_dispatch`
   and the optional string input `base_sha`, matching the feature workflow. Its only job prints
   a registration notice on a GitHub-hosted runner: no checkout, FAA, self-hosted runner, secrets,
   or FoD access. Review and merge this one-file bootstrap PR into `main`.
2. Incorporate the bootstrap commit into `feature/020-faa-risk-pilot` before publishing the pilot.
   Keep the full feature version of the same workflow, replacing the stub. If the pilot was already
   committed, resolve any add/add conflict by keeping that full version; do not merge the pilot
   into `main` yet.
3. Run the local helper/scoring tests below, then commit and push the reviewed feature changes.
   The workflow, helper and tests must exist on the remote feature branch.
4. Choose a full 40-character ancestor SHA whose range includes
   added/modified/copied/renamed/type-changed files under `packages/`.
   A tooling-only pilot commit has no package changes against its first parent, so supply an earlier
   source base rather than adding artificial application changes. Inspect history with
   `git log --format="%H %s" -- packages` and review `git diff --stat <base-sha>..HEAD -- packages`.
   Revision expressions, branches, non-ancestor bases, no-op and deletion-only ranges are rejected.
5. Dispatch the feature version explicitly, substituting the reviewed SHA:

   ```powershell
   gh workflow run faa-smoke-test.yml --repo fortify-presales/IWA-Agentic --ref feature/020-faa-risk-pilot -f base_sha=<base-sha>
   gh run list --repo fortify-presales/IWA-Agentic --workflow faa-smoke-test.yml --branch feature/020-faa-risk-pilot --event workflow_dispatch --limit 5
   ```

   Alternatively, select **feature/020-faa-risk-pilot**, not **main**, in
   **Actions > FAA Differential Smoke Test > Run workflow**.
6. Confirm the run's branch and exact head SHA. The hosted validation job must pass before the
   self-hosted scan job runs. Download the `faa-smoke-...` artifact and check that
   `faa-execution.json` records the feature ref, expected SHAs/range, `analyzerInvoked: true`,
   `analyzerExitCode: 0`, and `status: succeeded`, with valid SARIF and a nonempty FAA summary.
   A successful registration-only job on `main` is **not** evidence of FAA execution.
7. Only after a successful real branch smoke run, merge the complete pilot through its normal PR.
   Until then, leave assessment policy/scorer/helper code off `main`.

The full workflow permits only `main` and the named pilot branch in `fortify-presales/IWA-Agentic`;
other branches, tags, PR refs and forks are rejected. After merging the pilot, a dispatch from
`main` runs the full workflow; a blank `base_sha` uses the dispatched commit's first parent.

The only scan mode is:

```text
fortifyaa -scan <checkout> --scope packages --differential <base-sha>..<dispatched-sha>
  --output <artifacts>/faa.sarif --output-format sarif,md-summary
  --output-md-summary <artifacts>/faa-summary.md --message-format plain
  -b github-<repository-id>-<run-id>-<attempt>
```

`--differential` reports issues introduced on changed lines. There is no full-scan fallback,
`--incremental`, required baseline, complementary FoD/SSC input, or baseline update. The helper
checks the exact HEAD, base ancestry, clean package checkout, and FAA version before scanning.
No application build or application startup is run by the workflow.

Each attempt has a unique build ID so a persistent runner cannot automatically resume another
attempt's FAA state. Runs are not automatically cancelled by later dispatches. A 60-minute job
timeout bounds runner time, not LLM spend; configure cost/model limits in the runner's trusted FAA
policy. FAA state under the runner account is not globally cleaned; manage its retention separately.

Artifacts, retained for 14 days:

- `faa.sarif`: FAA findings (zero findings is a valid result).
- `faa-summary.md`: FAA's Markdown summary.
- `faa-execution.json`: dispatched ref, configured license backend, range, exact SHAs, run/attempt/build identity, version, scan invocation,
  analyzer exit status, duration, and success/failure.
- `faa-execution-summary.md`: concise workflow summary.

Nonzero analyzer exits and missing/malformed required outputs fail the job. The execution record
is retained on ordinary helper/analyzer failures; cancellation, timeout, or runner loss may prevent
finalization. Available artifacts are uploaded on failure. No successful result is synthesized.
Tests never invoke a real FAA process.

FAA artifacts can contain code snippets and sensitive findings; restrict repository/artifact access
and confirm retention before use. Dispatch is not a sandbox: use a dedicated least-privilege runner,
review changes on both allowed branches before dispatch, and govern FAA agent capabilities through its external policy.
Do not extend this job to forks or arbitrary PR branches on a persistent/shared runner.

## Deferred FoD and conditional execution milestones

The manual smoke test is independent of risk scoring. Selected assessment decisions still use the
existing `pending-runner-setup` placeholder; this does not assert runner readiness or execution.
Low-risk decisions report `not-selected`. Manual runs do not satisfy or update PR assessments.

After verifying a real smoke run, separately confirm source/import release IDs and approved
non-interactive FoD authentication before implementing import into a dedicated release.
Conditional exact-head-SHA PR execution, live Fortify metadata, baseline credit, suppression
detection, release gates, exceptions, PR comments, and effectiveness dashboards remain out of scope.

### Smoke-test helper validation

```powershell
node --test .github\tests\faa-smoke-test.test.mjs .github\tests\faa-risk-adapter.test.mjs
node --check .github\scripts\faa-smoke-test.mjs
```

These are local tests, not evidence that the remote runner's FAA configuration works.
