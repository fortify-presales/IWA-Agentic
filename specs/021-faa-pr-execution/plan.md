# Implementation Plan: Conditional FAA PR Execution

**Branch**: `feature/021-faa-pr-execution` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/021-faa-pr-execution/spec.md`.

## Summary

Extend the existing `pull_request_target` workflow rather than adding an artifact-triggered
privileged workflow. Hosted assessment publishes a validated execute/skip decision. A selected
self-hosted job checks out controls at the event base SHA and source at the head SHA, then
executes only the controls' helper. Recompute risk and verify current PR metadata on that runner.
Share license filtering and analyzer/output validation with the smoke helper, not its branch guard.

## Technical Context

- **Affected packages**: none.
- **Dependencies added/changed**: none; Node 20, Git and built-in fetch/test.
- **Data model changes**: execution evidence only.
- **Demo trust model**: main was unprotected at implementation time. The user approved using the
  existing self-hosted runner without repository-protection changes. Immutable base/head separation
  prevents direct execution of mutable PR helpers; it does not protect main from authorized writers,
  sandbox the FAA agent or restrict organization secrets independently.
- **Activation**: `FAA_PR_SCANS_ENABLED=true` after merged-control review. Existing jobs are unaffected.
- **Provider and licensing**: reuse existing FoD/SSC selection and OpenAI secret mapping.

## Constitution Check

- [x] **I. Intentional Insecurity Is Sacrosanct** - no package or vulnerable dependency changes.
- [x] **II. Documented Vulnerability Lifecycle** - no new intentional vulnerability.
- [x] **III. Monorepo Workspace Boundaries** - no package/build/tsconfig changes.
- [x] **IV. Fault-Tolerant Runtime Configuration** - credentials required only for selected scans.
- [x] **V. Fixable Bugs vs. Preserved Vulnerabilities** - changes are confined to scan tooling.

## Project Structure

### Documentation (this feature)

`spec.md`, `plan.md`, `tasks.md`, and updates to the existing pilot runbook.

### Source code (repository root)

- `.github/scripts/faa-execution.mjs`: shared analyzer invocation and licensing environment.
- `.github/scripts/faa-pr-scan.mjs`: trusted-control PR validation and execution record.
- Existing risk adapter, assessment workflow, smoke helper and focused tests.

## Complexity Tracking

No constitution violations. External protections and runner isolation are documented prerequisites
for production use, not silently asserted or configured by this change.
