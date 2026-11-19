# Risk-based FAA PR demonstration

## The example

FAA runs as two extra jobs in the existing platform workflow:
[fod.yml](../../.github/workflows/fod.yml) for FoD (default) or
[scancentral.yml](../../.github/workflows/scancentral.yml) for SSC.

1. **`FAA-Risk` (Ubuntu, parallel with SAST in normal mode):** run the tests and the dependency-free
   [risk adapter](../../.github/scripts/faa-risk-adapter.mjs). Publish the score,
   `do_faa` boolean and exact `merge-base(base,head)..head` range.
2. **`FAA-Scan` (existing FAA runner):** normally waits for both `Fortify-AST-Scan` and
   `FAA-Risk`. Only for selected, same-repository, non-draft PRs, run the
   [FoD](../../.github/custom-actions/fod/faa-scan.yaml) or
   [SSC](../../.github/custom-actions/ssc/faa-scan.yaml) differential action against
   the branch target, using existing platform findings as complementary context.
   Import the SARIF into that platform and retain the FAA reports in GitHub.

Release/application-version setup (owner, SDLC status, assessment type, issue template,
copy-from, scan settings) is owned solely by the SAST job's `fortify/github-action`
configuration; the FAA job never creates or configures a target. Normally FAA runs only
after SAST succeeds. For a demo, set the repository variable `FAA_DEMO_ONLY` to `true`:
on non-draft PRs this skips SAST and permits the risk-selected differential FAA job to use the
existing branch target. That target must already exist; run normal SAST once for the
branch before enabling demo-only mode. Unset the variable or set it to `false` to restore
normal behavior. Push and manual runs still run SAST regardless of this variable.
FAA only runs when the platform workflow's `pull_request` path filters match. Default
`pull_request` activity types apply, so declaration or label edits take effect on the
next push. There is no push, manual or full FAA scan.

## Configurable criteria

Edit [faa-policy.json](../../.github/faa-policy.json), not the adapter. Its `_instructions`
block explains the format. In short, it has one `threshold` and a list of `rules`. Each rule has a
`name`, `points` and exactly one condition:

- `label`: the PR has this label (`faa-required` is worth the full threshold, so it forces FAA).
- `paths`: case-insensitive regular expressions matched against changed repository paths.
- `declaration`: a `- <field>: <value>` answer in the PR body, from the existing PR template.
- `minChangedLines`: added plus deleted lines in the PR are at least this number.

Each matching rule adds its points once; FAA is selected when the score reaches the threshold.
These are configurable heuristics, not semantic analysis. Declarations can only add risk.

The adapter contains no repository-specific configuration. Copy it and a policy to another
repository and adjust the rules; its header comment shows the workflow wiring and how to add
a new rule type.

## Configuration and destinations

- Node 20+ and Git suffice for assessment.
- The scan job uses `[self-hosted, Linux, X64, fortify, faa]`; change these labels for another runner.
- FAA must already be installed/configured. The workflow sets up fcli 3.30.0 using the
  official Fortify setup action; the custom actions register preinstalled FAA only.
- `FAA_LICENSE_PLATFORM` is `fod` (default) or `ssc`; it selects which platform workflow
  runs the FAA jobs, so a PR never gets two FAA scans.
- `FAA_DEMO_ONLY` is unset/`false` by default. Set it to `true` to skip SAST on non-draft PRs and
  run only risk-selected differential FAA scans against an existing branch target.
- FoD: variable `FOD_URL`, secrets `FOD_CLIENT_ID` and `FOD_CLIENT_SECRET`.
  `FOD_DEFAULT_OWNER` is used when supplied for application creation.
- SSC: variable `SSC_URL`, secret `SSC_TOKEN`.
- The existing provider uses secret `OPENAI_API_KEY`. FAA's external configuration controls
  the provider, tools and spend limits; this workflow does not provision those.
- Organization variables/secrets must grant this repository access. URLs are variables, not secrets.

The target is **`<github.repository>:<github.head_ref>`**, the same name `fortify/github-action`
uses for the SAST job. For example, a branch `demo/faa` in this repository
uses `fortify-presales/IWA-Agentic:demo/faa`.

The FoD action uses FAA's `--fod-release` integration, and the SSC action uses
`--ssc-appversion`, to obtain existing findings directly from their respective platforms.
Neither action downloads an FPR or starts or waits for a new SAST scan. Findings available
at run time are used as complementary context. This is not a fallback to a full FAA scan.
FoD SARIF processing is asynchronous; SSC waits for artifact processing.

### Previous FAA SARIF

The workflows also restore a prior FAA SARIF using GitHub's artifact API and
`actions/download-artifact`. The shared
[baseline helper](../../.github/scripts/faa-sarif-baseline.mjs) selects the newest eligible
earlier successful run of the same workflow, backend, repository, PR and source branch.
The prior source commit must be an ancestor of the current PR head, and the merge-base
SHA must match the risk adapter's current FROM commit. Metadata in the artifact is checked
again after download. Other PRs, retargeted bases, abandoned force-push heads, failed runs,
expired artifacts and the current run (including earlier attempts) are not reused.

The three inputs are independent:

- `--differential FROM..TO` continues to determine the PR lines analyzed.
- `--fod-release` / `--ssc-appversion` supplies complementary Fortify SAST findings.
- Optional `--baseline previous-faa.sarif` reuses FAA finding instance IDs across drift.
  In differential mode it does not carry forward all historical findings or change the range.

The option was verified against `fortifyaa -help` for FAA 26.4.0, which lists
`[--baseline <file>] (reuse a prior scan's instance-ids across drift)` and states that for
`--differential <range>`, "`--baseline` is optional (adds instance-id continuity with a prior
scan)". There is no `--previous-sarif` option.

The restored file is `$RUNNER_TEMP/faa-previous/previous-faa.sarif`, outside the source
checkout. Missing baselines are normal; discovery/download failures or invalid previous
SARIF/metadata log a warning and scanning continues without `--baseline`. No empty baseline
is generated. If the newest selected artifact is invalid, older artifacts are not tried.

After the existing FAA scan and platform import succeed, the helper validates the nonempty
SARIF 2.1.0 report at `$RUNNER_TEMP/faa-output/faa.sarif` and writes `faa-baseline.json`
with repository, PR, branch, workflow, full FROM/TO SHAs, run ID and attempt. These two files
are uploaded as an immutable, run-specific artifact:
`faa-sarif-<backend>-pr<PR>-<FROM>-<TO>-<run-ID>-<attempt>`.
Retention remains 14 days, matching the existing report artifacts. A failed scan or invalid
current report cannot publish a reusable baseline. Existing always-uploaded diagnostic
reports remain separate and are never selected as baselines.

Only artifacts with this metadata contract are eligible: the first run after this update
seeds a baseline; a subsequent successful PR run can reuse it. A changed merge base also
starts a new baseline. Artifact discovery requires `actions: read` on the FAA job; no write
permission is added.

Each FAA job only receives its own platform's credentials. Named fcli sessions are logged
out on ordinary completion/failure. The old `FAA_PR_SCANS_ENABLED` variable is no longer
used: selection is driven directly by the configured criteria.

## Adapter interface

```powershell
node .github\scripts\faa-risk-adapter.mjs --event C:\temp\pr-event.json --source C:\temp\pr-source --policy .github\faa-policy.json --output C:\temp\faa-risk
```

`--event` defaults to `GITHUB_EVENT_PATH`; `--policy` defaults to the policy beside the
script's parent directory. The source checkout must be at the event's head SHA and contain
the base history. Required event fields are `pull_request.{number,body,labels,base.sha,base.repo.id,head.sha}`;
`head.repo.id` must match `base.repo.id` for `do_faa=true`.

Outputs written after successful assessment:

- `faa-risk-result.json`: score, threshold, matched rules with evidence, range and `doFaa`.
- `faa-risk-summary.md`: human-readable evidence.
- `GITHUB_OUTPUT`: `score`, `do_faa`, `change_range`.

Below-threshold scores, forks and deletion-only diffs do not select FAA.
Draft PRs are skipped by the workflow.

fcli 3.30.0's built-in `ci` action **does not implement `DO_FAA`**. The example therefore
uses `if: needs.FAA-Risk.outputs.do_faa == 'true'` to gate a direct custom-action invocation,
rather than setting an ignored environment variable or copying the built-in CI action.
The same output can feed `DO_FAA` when a future CI integration supports it.

Both platform actions require `--source-dir` (or `SOURCE_DIR`). They support two modes:

- **PR differential:** supply `--pr-number` and `--change-range` together (or
  `FAA_PR_NUMBER`, `FAA_CHANGE_RANGE`). Only two distinct full commit SHAs are accepted
  for the merge-base..head range. `--scope` optionally narrows the changed files.
- **Scope-only:** omit both PR options and supply `--scope` (or `FAA_SCOPE`). FAA scans
  all selected files, not just changed lines. Ensure `FAA_PR_NUMBER` and `FAA_CHANGE_RANGE`
  are unset when using this mode. This mode is available for direct action use only;
  the existing GitHub workflows remain PR differential scans.

The target comes from `--rel` / `FOD_RELEASE` or `--av` / `SSC_APPVERSION`.
Arbitrary extra scan options are unavailable. For example, with an authenticated fcli
session and FAA already configured, scan all application files:

```powershell
fcli fod action run .github\custom-actions\fod\faa-scan.yaml --source-dir "$PWD" --scope "$PWD\packages" --rel "<existing-release>"
fcli ssc action run .github\custom-actions\ssc\faa-scan.yaml --source-dir "$PWD" --scope "$PWD\packages" --av "<existing-app:version>"
```

These commands import/upload results to the specified target. Neither action runs SAST.
The optional `--baseline` action option defaults to `FAA_PREVIOUS_SARIF` and is omitted
from the FAA command when no validated previous report was restored. The optional `--scope`
option defaults to `FAA_SCOPE`; both workflows set it to `<workspace>/packages`, so only
changed application files under `packages/` are analysed. `-scan` stays at the repository
root because `--differential` needs the Git repository.

## Validation and demonstration

```powershell
node --test .github\tests\faa-risk-adapter.test.mjs .github\tests\faa-sarif-baseline.test.mjs
fcli fod action help .github\custom-actions\fod\faa-scan.yaml
fcli ssc action help .github\custom-actions\ssc\faa-scan.yaml
git --no-pager diff --check
```

Use a same-repository, non-draft PR with a real added/modified file and completed declarations.
Adding the configured `faa-required` label is a deterministic selection case; no artificial
application vulnerability is necessary. Check the exact range in `faa-risk-result.json`,
the fcli scan/import step result, and the platform's **branch** target.
The `faa-scan-<PR>` artifact (`faa-scan-ssc-<PR>` for SSC) contains `faa.sarif` and
`faa.sarif.md`; the risk artifact is separate.
Below-threshold cases should retain risk evidence with the scan job skipped.
No skipped, cancelled or test-only job proves FAA execution.
To prove baseline reuse, push two successive risk-selected changes on the same PR without
changing its merge base. The first run publishes the scoped baseline artifact; after it
finishes successfully, the second run should log `FAA previous SARIF available: true`
and invoke FAA with `--baseline`. Its FROM/TO range still comes from the risk adapter.

Findings are report-only, not a release gate. Importing or reporting a finding does not
resolve it, suppress it or record risk acceptance. Artifacts are retained for 14 days and
may contain code snippets; consider access/retention when copying this public demo.

## Demo trust boundary

This is an example for **trusted same-repository contributors**, not an independent security
control over hostile PR authors. The workflow, scorer, policy and custom actions come from
the PR revision; changing them can change what runs. Forks never reach the credentialed job.
Credentials are limited to the scan step; checkout credentials are not persisted.
Superseded PR runs are not cancelled automatically; an import already submitted is not undone.

FAA is an agent processing PR content. Its external tool/network restrictions, model limits
and runner isolation are not established by this workflow; a timeout is not a spending cap.
Use a dedicated least-privilege runner and review CI/control changes before triggering scans.
The earlier Critical Build Script Injection finding still needs explicit owner disposition:
retiring its old launcher is not a claim of formal risk acceptance or a general trust-boundary fix.
