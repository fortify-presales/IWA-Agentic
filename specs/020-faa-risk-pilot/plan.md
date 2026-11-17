# Implementation Plan: FAA Risk Pilot

**Branch**: `feature/020-faa-risk-pilot` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)
**Input**: Repository-local, audit-only FoD pilot.

## Summary

First prove a deterministic, explainable Node scorer with no external services. Use a
read-only `pull_request_target` assessment: check out controls at the base SHA and source
at the head SHA in separate directories. Never import, install, build, or execute head code.
The source checkout supplies only Git diff data. Existing FoD/ScanCentral workflows stay unchanged.

## Technical Context

- **Affected packages**: none.
- **Dependencies added/changed**: none; Node 20+, Git, built-in `node:test`.
- **Data model changes**: none in the application.
- **Policy format**: JSON instead of YAML, avoiding a parser dependency.
- **Scoring**: a single `.github/scripts/faa-risk-adapter.mjs` implementation.
- **FAA smoke execution**: a separate dependency-free Node helper and a manual-only workflow.
  GitHub-hosted dispatch/tests precede the self-hosted job; no real FAA is invoked by tests.
- **Capability findings**: fcli 3.30.0 is installed locally. Custom action array inputs split
  on commas; documented helpers do not provide JSON-file parsing. An offline ObjectMapper
  constructor probe failed. Node scoring was explicitly approved instead of fragile encoding.
- **Confirmed runner**: `aws-ubuntu-runner-01`, labels `[self-hosted, Linux, X64, fortify, faa]`.
- **Live-run prerequisites**: verify runner service-account FAA 26.4.0 service/license/provider
  configuration and isolation. Actual FoD release IDs/authentication are needed only for later import.
- **Licensing configuration**: `FAA_LICENSE_PLATFORM` selects `fod` (default) or `ssc`.
  Map existing Actions URL variables and credential secrets to `FCLI_DEFAULT_*` only for the
  FAA step. Validate selected settings and exclude the other backend from FAA's environment.
  Platform licensing is distinct from later FoD result import.

## Constitution Check

- [x] **I. Intentional Insecurity Is Sacrosanct** — no source or vulnerable dependency changes.
- [x] **II. Documented Vulnerability Lifecycle** — no new intentional vulnerability.
- [x] **III. Monorepo Workspace Boundaries** — no package/build/tsconfig changes.
- [x] **IV. Fault-Tolerant Runtime Configuration** — no new application credentials or startup code.
- [x] **V. Fixable Bugs vs. Preserved Vulnerabilities** — tooling only.

## Project Structure

### Documentation (this feature)

`spec.md`, `plan.md`, `tasks.md`, and [the runbook](./README.md).

### Source code (repository root)

- `.github/faa-policy.json`
- `.github/scripts/faa-risk-adapter.mjs`
- `.github/tests/faa-risk-adapter.test.mjs`
- `.github/workflows/faa-risk-assessment.yml`
- `.github/scripts/faa-smoke-test.mjs`
- `.github/tests/faa-smoke-test.test.mjs`
- `.github/workflows/faa-smoke-test.yml`
- `.github/actionlint.yaml` allowlists the confirmed custom runner labels for workflow linting.
- Existing `.github/PULL_REQUEST_TEMPLATE.md` extended, not replaced.
- One `.gitignore` exception for `.github/faa-policy.json` (new JSON files are otherwise ignored).

## Milestones

1. Implement policy, scorer, safe Git normalization, outputs, and focused tests.
2. Add trusted read-only assessment workflow and evidence retention; no release enforcement.
3. Add a manually dispatched FAA 26.4.0 differential-only smoke test of reviewed package changes
   on `main` or `feature/020-faa-risk-pilot`. Validate it without real FAA calls. Merge only a
   harmless dispatcher stub into `main`, incorporate that base into the feature branch, then
   verify actual feature-branch execution on the registered runner before merging the full pilot.
   No full/incremental scan, baseline requirement, live self-test, or FoD integration in this step.
4. Separately confirm FoD IDs/authentication before implementing dedicated-release import.
5. Bind conditional FAA execution to the assessed head SHA, isolate credentials, capture failures
   and duration, and optionally add one updateable PR report. Confirm owners before CODEOWNERS.
6. Evaluate standing metadata scores and finding yield before considering production gates.

## Complexity Tracking

No constitution violations. This milestone intentionally does not claim full enterprise-spec compliance.
