# Feature Specification: Conditional FAA PR Execution

**Status**: Implemented locally; live validation pending | **Branch**: `feature/021-faa-pr-execution` | **Date**: 2026-11-18
**Input**: Connect mandatory PR risk decisions to exact-head FAA scans using trusted base controls.

## Overview

Extend the audit-only risk pilot with differential FAA execution before PR merge.
Controls are loaded from the immutable PR base; the PR head is a separate, credential-free
checkout used only as scan input. Use the existing self-hosted demo runner, not a new environment.

## Is this an intentional vulnerability demonstration?

- [x] No - tooling only; existing application vulnerabilities remain unchanged.

## User Scenarios

### Primary scenario

Given an enabled, same-repository, non-draft PR into main with a mandatory decision, scan the
exact assessed head using base-revision control code and retain execution evidence and findings.

### Additional scenarios

- Recommended decisions remain advisory; low risk, disabled execution and forks record distinct skips.
- A changed head/base, closed/draft PR or changed declarations/labels makes the old run stale.
- Analyzer errors and malformed outputs fail explicitly; findings are retained, not a release gate.

### Edge cases

Use the merge base for diverged branches. Never install, build, import or execute PR scripts.
Reject symlinks and submodules in scan input rather than allowing traversal outside the source tree.
Cancellation/runner loss may prevent final evidence; stale/cancelled runs never attest a newer head.

## Functional Requirements

- **FR-001**: Opt in using `FAA_PR_SCANS_ENABLED=true`; select only mandatory decisions.
- **FR-002**: Run workflow/helper code at the event base SHA, in a different directory from head data.
- **FR-003**: Recompute and validate the assessment on the runner; verify current PR identity and
  snapshot before scanning and again after successful analysis.
- **FR-004**: Use only differential FAA 26.4.0, unique per-attempt build IDs and existing FoD/SSC
  licensing/OpenAI settings. Exclude the other licensing namespace and GitHub API tokens from FAA.
- **FR-005**: Record exact base/head/control/diff SHAs, assessment identity, status, duration,
  analyzer exit and finding count; require valid SARIF and nonempty Markdown for completed scans.
- **FR-006**: Preserve existing SAST/SCA workflows, smoke-test defaults and application behavior.

## Out of Scope

FoD/SSC import, PR comments, production release gates, automatic repository-protection changes,
fork scans, arbitrary head overrides, LLM/provider provisioning and independent runner sandboxing.

## Success Criteria

- **SC-001**: Tests distinguish mandatory, advisory, not-selected, fork and disabled outcomes.
- **SC-002**: Mismatched controls/head, stale metadata and unsafe checkout entries prevent FAA.
- **SC-003**: Fake-executor tests prove parameterized invocation, isolated controls and credential handling.
- **SC-004**: Failure evidence remains a failure and success cannot attest a different PR revision.

## Affected Packages

None. GitHub tooling and specifications only.
