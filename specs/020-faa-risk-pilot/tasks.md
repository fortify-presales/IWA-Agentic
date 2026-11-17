# Tasks: FAA Risk Pilot

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)
**Tests**: Focused scoring and Git-normalization behavior introduced by this feature.

## Phase 1: Setup

- [x] T001 Verify local Node/fcli/FAA availability without logins or scans; agree Node scoring
  and deferred live runner setup.
- [x] T002 Create `specs/020-faa-risk-pilot/` documentation using repository templates.

## Phase 2: Foundational

- [x] T003 Add validated pilot policy in `.github/faa-policy.json` and a targeted `.gitignore` exception.
- [x] T004 Implement the single scorer/adapter in `.github/scripts/faa-risk-adapter.mjs`.

## Phase 3: Core Implementation

- [x] T005 Add focused tests in `.github/tests/faa-risk-adapter.test.mjs`.
- [x] T006 Extend `.github/PULL_REQUEST_TEMPLATE.md` without removing existing sections.
- [x] T007 Add trusted, read-only `.github/workflows/faa-risk-assessment.yml`.

## Phase 4: Polish & Cross-Cutting Concerns

- [x] T008 Update `faa-github-risk-scoring-spec.md` for Node scoring and pilot scope.
- [x] T009 Document exact local/test commands and rollout limitations in `README.md` here.
- [x] T010 Run focused tests, diff checks, and static change-scoped security review.

### Validation evidence (local Windows, Node 22.22.1)

- `node --test .github\tests\faa-risk-adapter.test.mjs` — passed, 13 tests.
- `node --check .github\scripts\faa-risk-adapter.mjs` — passed.
- `actionlint.exe -shellcheck= -pyflakes= .github\workflows\faa-risk-assessment.yml` — passed
  using checksum-verified actionlint 1.7.7 in temporary session tooling.
- `git --no-pager diff --check` — passed.
- `node node_modules\eslint\bin\eslint.js .github\scripts\faa-risk-adapter.mjs .github\tests\faa-risk-adapter.test.mjs`
  — unavailable: repository dependencies are not installed. No dependency restoration was performed.
- Node 20 Windows/Linux/macOS jobs are configured, but hosted execution remains unverified until rollout.
- Static change review: JSON is data-only; subprocesses use argument arrays and validated SHAs;
  PR paths are evidence, not filesystem destinations; no PR code execution or new credential access.

## Phase 5: Manual FAA Differential Smoke Test

- [x] T011 Confirm runner labels and agree manual differential scope on `main` and the named pilot branch.
- [x] T012 Add `.github/workflows/faa-smoke-test.yml` and testable Node helper, without FoD import.
- [ ] T013 Verify a real remote smoke run, including provider/service/license access and artifact output.
- [ ] T014 Confirm control owners, add CODEOWNERS, and optionally add a single updated PR comment.
- [ ] T015 Separately confirm FoD IDs/authentication and implement dedicated-release import.
- [ ] T016 Separately design isolated, conditional exact-head-SHA execution for selected assessments.

### Smoke-test validation

- `node --test .github\tests\faa-smoke-test.test.mjs .github\tests\faa-risk-adapter.test.mjs`
  — passed, 22 tests; FAA calls are fake executors, never live scans.
- `node --check .github\scripts\faa-smoke-test.mjs` — passed.
- `actionlint.exe -config-file .github\actionlint.yaml -shellcheck= -pyflakes= .github\workflows\faa-smoke-test.yml .github\workflows\faa-risk-assessment.yml`
  — passed using checksum-verified actionlint 1.7.7; configuration allowlists the registered custom runner labels.
- `git --no-pager diff --check` — passed.
- Hosted workflow/self-hosted FAA execution remains unverified. Only the harmless dispatcher
  stub must be merged into `main` first; test the full feature workflow before merging the pilot.

## Phase 6: Feature-Branch Rollout

- [x] T017 Allow only `main` and `feature/020-faa-risk-pilot` in both workflow and helper;
  cover the approved feature ref and rejection of other refs/forks in tests.
- [x] T018 Review and merge a separate one-file, notice-only dispatcher bootstrap PR into `main`
  ([#24](https://github.com/fortify-presales/IWA-Agentic/pull/24)).
- [ ] T019 Incorporate that bootstrap base, then publish the reviewed pilot feature branch.
- [ ] T020 Dispatch the feature workflow with a reviewed source-change base and inspect real
  execution records, SARIF, and Markdown before merging the complete pilot.

## Dependencies

T003 precedes T004; T004 precedes T005/T007; T010 follows T003–T009.
T011 precedes T012; T013 is required before claiming remote execution is proven.
T017/T018 precede T019; T019 precedes T020, which provides the evidence for T013.
T015/T016 remain separate later milestones, not part of the manual-only smoke test.
