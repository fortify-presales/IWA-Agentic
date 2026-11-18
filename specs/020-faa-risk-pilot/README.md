# Risk-based FAA PR demonstration

## The example

FAA runs as two extra jobs in the existing platform workflow:
[fod.yml](../../.github/workflows/fod.yml) for FoD (default) or
[scancentral.yml](../../.github/workflows/scancentral.yml) for SSC.

1. **`FAA-Risk` (Ubuntu, parallel with SAST):** run the tests and the dependency-free
   [risk adapter](../../.github/scripts/faa-risk-adapter.mjs). Publish the score,
   decision, `do_faa` boolean and exact `merge-base(base,head)..head` range.
2. **`FAA-Scan` (existing FAA runner):** `needs` both `Fortify-AST-Scan` and `FAA-Risk`.
   Only for selected, same-repository, non-draft PRs, run the
   [FoD](../../.github/custom-actions/fod/faa-scan.yaml) or
   [SSC](../../.github/custom-actions/ssc/faa-scan.yaml) differential action against
   the branch target the SAST job set up, using its SAST results as context.
   Import the SARIF into that platform and retain the FAA reports in GitHub.

Release/application-version setup (owner, SDLC status, assessment type, issue template,
copy-from, scan settings) is owned solely by the SAST job's `fortify/github-action`
configuration; the FAA job never creates or configures a target. FAA therefore only runs
when the platform workflow's `pull_request` path filters match and the SAST job succeeds.
Default `pull_request` activity types apply, so declaration or label edits take effect on
the next push. There is no push, manual or full FAA scan.

## Configurable criteria

Edit [faa-policy.json](../../.github/faa-policy.json), not the adapter:

- `scores`, `thresholds`: weights and inclusive recommended/mandatory cutoffs.
- `mandatorySignals`: path/declaration signals that force scanning.
- `mandatoryInternetApi`: whether an API change plus internet exposure forces scanning.
- `requiredLabels`: labels that force scanning (initially `faa-required`).
- `paths`: case-insensitive regular expressions against repository-relative Git paths.
- `application`: standing application risk; the supplied classification is a pilot assumption.
- `changeSize`, `dependencyPatterns`, `nonExecutablePatterns`: size and dependency criteria.

Initial behavior is preserved: internet exposure contributes 4 points; scores 5-8 are
advisory and 9+ select FAA. Auth, secrets and incident signals are mandatory regardless of
score; an internet-facing API change is mandatory too. Each signal scores once.
Size counts added plus deleted executable lines, using thresholds of 500 high-risk or
1500 general lines. Renames retain both paths as evidence; binary changes add no lines.
Lockfiles still contribute dependency risk. These are configurable heuristics, not semantic analysis.

Complete the existing PR-template declarations without changing their labels. Missing answers
remain `unknown`; path evidence overrides negative declarations; duplicate answers fail.
An agent review or passing test is not human manual review. Removing a label cannot cancel
other mandatory evidence.

The adapter contains no repository name, branch name, PR number, runner or credential
configuration. Copy it and a policy to another repository, adjust its patterns/metadata,
and optionally copy the declaration sections of the PR template.

## Configuration and destinations

- Node 20+ and Git suffice for assessment.
- The scan job uses `[self-hosted, Linux, X64, fortify, faa]`; change these labels for another runner.
- FAA must already be installed/configured. The workflow sets up fcli 3.30.0 using the
  official Fortify setup action; the custom actions register preinstalled FAA only.
- `FAA_LICENSE_PLATFORM` is `fod` (default) or `ssc`; it selects which platform workflow
  runs the FAA jobs, so a PR never gets two FAA scans.
- FoD: variable `FOD_URL`, secrets `FOD_CLIENT_ID` and `FOD_CLIENT_SECRET`.
  `FOD_DEFAULT_OWNER` is used when supplied for application creation.
- SSC: variable `SSC_URL`, secret `SSC_TOKEN`.
- The existing provider uses secret `OPENAI_API_KEY`. FAA's external configuration controls
  the provider, tools and spend limits; this workflow does not provision those.
- Organization variables/secrets must grant this repository access. URLs are variables, not secrets.

The target is **`<github.repository>:<github.head_ref>`**, the same name `fortify/github-action`
uses for the SAST job. For example, a branch `demo/faa` in this repository
uses `fortify-presales/IWA-Agentic:demo/faa`.

Each action takes the latest SAST FPR from the branch target as context; because FAA waits
for the SAST job this is normally the scan just completed. If unavailable, it logs a warning
and continues without SAST context. This is not a fallback to a full FAA scan.
FoD SARIF processing is asynchronous; SSC waits for artifact processing.

Each FAA job only receives its own platform's credentials. Named fcli sessions are logged
out on ordinary completion/failure. The old `FAA_PR_SCANS_ENABLED` variable is no longer
used: selection is driven directly by the configured criteria.

## Adapter interface

```powershell
node .github\scripts\faa-risk-adapter.mjs --event C:\temp\pr-event.json --source C:\temp\pr-source --policy .github\faa-policy.json --output C:\temp\faa-risk
```

`--event` defaults to `GITHUB_EVENT_PATH`; `--policy` defaults to the policy beside the
script's parent directory. The source checkout must be at the event's head SHA and contain
the base history. Required event fields are `repository.{id,full_name}` and
`pull_request.{number,draft,body,labels,base.sha,base.repo.id,head.sha}`.
`head.repo.id` must match the repository ID for `do_faa=true`.

Outputs written after successful assessment:

- `faa-risk-result.json`: score, reasons, policy hash, PR identity, exact SHAs/range,
  declarations, conflicts and `doFaa`.
- `faa-risk-summary.md`: human-readable evidence.
- `GITHUB_OUTPUT`: `score`, `mandatory`, `decision`, `do_faa`, `change_range`.

Low/recommended scores, forks and empty/deleted-only diffs do not select FAA.
The JSON status `pending-execution` means selected, not that a scan succeeded.
Draft PRs are skipped by the workflow and rejected by local adapter invocation.

fcli 3.30.0's built-in `ci` action **does not implement `DO_FAA`**. The example therefore
uses `if: needs.FAA-Risk.outputs.do_faa == 'true'` to gate a direct custom-action invocation,
rather than setting an ignored environment variable or copying the built-in CI action.
The same output can feed `DO_FAA` when a future CI integration supports it.

Both platform actions require `--source-dir`, `--pr-number` and `--change-range`
(or `SOURCE_DIR`, `FAA_PR_NUMBER`, `FAA_CHANGE_RANGE`). The target comes from `--rel` /
`FOD_RELEASE` or `--av` / `SSC_APPVERSION`. Only two distinct full commit SHAs are accepted
for the range. Arbitrary extra scan options and full-scan mode are deliberately unavailable.

## Validation and demonstration

```powershell
node --test .github\tests\faa-risk-adapter.test.mjs
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
Recommended/low-risk cases should retain risk evidence with the scan job skipped.
No skipped, cancelled or test-only job proves FAA execution.

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
