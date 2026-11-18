# Tasks: Conditional FAA PR Execution

**Input**: [spec.md](./spec.md), [plan.md](./plan.md).
**Tests**: Focused fake-executor and Git-backed tests; no paid scans during local validation.

## Phase 1: Setup

- [x] T001 Verify #25 merged, inspect runner/workflows and confirm mandatory-only demo scope.
- [x] T002 Create this specification from the repository templates.

## Phase 2: Foundational

- [x] T003 Extract shared FAA invocation/environment handling into `.github/scripts/faa-execution.mjs`.
- [x] T004 Record explicit execution selection in `.github/scripts/faa-risk-adapter.mjs`.

## Phase 3: Core Implementation

- [x] T005 Add `.github/scripts/faa-pr-scan.mjs` with immutable controls/head validation and stale checks.
- [x] T006 Extend `.github/workflows/faa-risk-assessment.yml` with the gated trusted-control scan job.

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T007 Cover selection, trust boundaries, subprocess arguments and failure evidence in focused tests.
- [x] T008 Update the pilot runbook with activation, demo limitations and rollout steps.
- [x] T009 Run focused tests, syntax checks, workflow lint and static change review.
- [ ] T010 After review/merge, verify real same-repository PR execution and skip cases on GitHub.
- [x] T011 Add and test the library-only PR-26 pinned pre-merge validation context.
- [x] T012 Prepare a separate main-based bootstrap workflow pinned to the candidate commit for review.
- [ ] T013 After human review, publish the candidate and bootstrap PR; merge only the bootstrap
  before explicitly approving a paid validation dispatch. No publication/merge/scan is authorized yet.
- [ ] T014 After bootstrap merge, verify risk evidence, exact SHAs, live FAA outputs and failure/skip
  semantics for PR 26. Production `pull_request_target` execution still requires T010 after feature merge.

## Dependencies

T001/T002 precede T003-T006; T003/T004 precede T005; T005 precedes T006.
T007-T009 follow implementation. T010 requires merged controls and explicit activation.
T011 precedes T012; T012 and human review precede T013; T013 precedes T014.

## Local validation

- `node --test .github\tests\faa-risk-adapter.test.mjs .github\tests\faa-smoke-test.test.mjs .github\tests\faa-pr-scan.test.mjs`
  - passed, 38 tests, using Node 22.22.1 on Windows. All FAA calls are fake executors.
- `node --check .github\scripts\faa-execution.mjs`
  - passed.
- `node --check .github\scripts\faa-pr-scan.mjs`
  - passed.
- `node --check .github\scripts\faa-risk-adapter.mjs`
  - passed.
- `node --check .github\scripts\faa-smoke-test.mjs`
  - passed.
- `actionlint.exe -config-file .github\actionlint.yaml -shellcheck= -pyflakes= .github\workflows\faa-risk-assessment.yml .github\workflows\faa-smoke-test.yml`
  - passed with checksum-verified actionlint 1.7.7. Shellcheck/Pyflakes were disabled.
- `git --no-pager diff --check`
  - passed.
- Ubuntu-only follow-up: YAML assertions passed for `ubuntu-latest`, no matrix, identical test
  steps and unchanged assessment/scan behavior.
- `actionlint.exe -config-file .github\actionlint.yaml -shellcheck= -pyflakes= .github\workflows\faa-risk-assessment.yml`
  - passed after removing the OS matrix. Tests were not rerun for this scheduling-only change.
- Static change review covered workflow selection/authorization, parameterized subprocesses and
  untrusted PR data, plus the FAA agent boundary. No new high-confidence code findings identified.
  External FAA tool/prompt/spend policy and runner isolation were not independently verified.
  Main protection and the legacy manual smoke workflow's Critical finding remain separate risks.

The workflow's Node 20 Ubuntu job, real PR API checks and paid FAA execution
remain unverified on GitHub until T010. No repository variable, protection or secret was changed,
and no paid scan was launched for this implementation.

### Pre-merge bootstrap preparation

- After adding the library-only validation context, the combined test command above passed
  **39 tests**. The production context still rejects a non-base control checkout, even with an
  approval-named environment variable; only the trusted library caller can supply the override.
- The new validation case checks exact candidate/head matching, actual base/launcher identity,
  PR 26 restriction, main/manual-dispatch restriction, policy hash and retained risk evidence.
- The cloned Git fixture explicitly disables automatic line-ending conversion so switching its
  approved controls does not inherit workstation-specific checkout behavior.
- `node --check .github\scripts\faa-pr-scan.mjs` and `git --no-pager diff --check` passed.
- Checksum-verified actionlint 1.7.7 passed for the risk workflow and the separate local bootstrap
  workflow, with Shellcheck/Pyflakes disabled.
- Local candidate/launcher commits are prepared for review only. The user requested no publication
  until the added code has been reviewed; no push, PR-body update, merge or paid scan is authorized.
