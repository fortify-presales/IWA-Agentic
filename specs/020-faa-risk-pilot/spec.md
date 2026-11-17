# Feature Specification: FAA Risk Pilot

**Status**: In progress | **Branch**: `feature/020-faa-risk-pilot` | **Date**: 2026-11-17
**Input**: Prove PR risk scoring and, subsequently, FAA execution using FoD with minimal repository impact.

## Overview

Add an audit-only GitHub PR assessment using a dependency-free Node.js ES module.
Keep existing FoD SAST/SCA workflows independent. A second milestone adds a manual-only,
FAA differential smoke test on the confirmed self-hosted runner labels, restricted to `main`
and the approved `feature/020-faa-risk-pilot` branch.
FoD import and conditional PR execution remain deferred.

This is the scoped implementation of [the broader specification](../../faa-github-risk-scoring-spec.md).
The user approved replacing both the PowerShell adapter and fcli scorer with one Node module
after fcli 3.30.0 input-interface probes. No encoded filenames or duplicate scoring engines
are required.

## Is this an intentional vulnerability demonstration?

- [x] No — this is a normal tooling feature. Existing intentional vulnerabilities remain unchanged.

## User Scenarios

### Primary scenario

Given a non-draft PR, assess changes using protected base-revision control code and policy,
then publish an explainable decision, Actions summary, and JSON artifact.

### Additional scenarios

- AI declarations add context; they do not independently force a mandatory decision.
- Authentication or secrets changes trigger mandatory FAA even if the PR declares no impact.
- Removing `faa-required` does not override another mandatory trigger.
- Invalid required policy or unavailable Git history fails assessment, not to a low-risk default.
- A maintainer manually scans a reviewed commit on either allowed branch against its first
  parent or a supplied ancestor using FAA differential mode only, without FoD or a baseline.
- A harmless default-branch dispatcher stub permits testing the feature workflow on the real
  runner before merging the complete pilot.

### Edge cases

Renames retain both paths as evidence; deletions count removed lines; binary paths still
participate in sensitive/dependency detection. Tabs, newlines, commas, and literal expression
syntax in paths remain data. Invalid UTF-8 filenames fail explicitly.

## Functional Requirements

- **FR-001**: Use one Node 20+ module for normalization, scoring, and output validation.
- **FR-002**: Load JSON policy from beside trusted control code, never from PR source.
- **FR-003**: Apply configured weights once per signal, thresholds 5/9, and mandatory overrides.
- **FR-004**: Record SHAs, repository ID, policy hash, reasons, paths, metadata provenance,
  unanswered declarations, unevaluated signals, and FAA execution status.
- **FR-005**: Publish `score`, `mandatory`, and `decision` only after successful assessment.
- **FR-006**: Run without installing application dependencies, credentials, or executing PR code.
- **FR-007**: Preserve all existing application, dependency, and SAST/SCA behavior.
- **FR-008**: The smoke test MUST validate trusted dispatch, exact HEAD, ancestor base, clean
  package source, changed package paths, and FAA 26.4.0 before running `--differential`.
- **FR-009**: Use per-attempt build identities and preserve execution metadata, SARIF, and Markdown.
  Analyzer failures or invalid outputs MUST fail, with no full/incremental fallback or FoD import.
- **FR-010**: Allow smoke execution only in `fortify-presales/IWA-Agentic` on `main` or
  `feature/020-faa-risk-pilot`. Register a notice-only dispatcher on `main`, then prove real
  feature-branch execution before merging the complete pilot.
- **FR-011**: Select FoD or SSC licensing through `FAA_LICENSE_PLATFORM` (default `fod`).
  Map existing Actions settings to the selected backend's `FCLI_DEFAULT_*` environment names,
  require its URL/credentials before invoking FAA, and keep credentials out of arguments/evidence.

## Out of Scope

Automatic PR FAA runs and FoD imports; automatic PR comments; production gates/exceptions; CODEOWNERS changes
without confirmed owners; live FoD/SSC metadata; baseline discounts; suppression ingestion;
topics/tags; semantic API/dependency diffs; central services and dashboards.

## Success Criteria

- **SC-001**: Focused fixtures prove all threshold boundaries and mandatory overrides.
- **SC-002**: Git-backed tests cover renames, deletions, binary files, and unusual paths.
- **SC-003**: Workflow control files come from the PR base SHA; head checkout is data only.
- **SC-004**: Selected PR assessment decisions remain pending, never falsely reported as completed
  FAA executions. Manual smoke-test outcomes are recorded separately.
- **SC-005**: Fake-executor tests prove differential-only invocation, ancestor checks, and
  failure handling without LLM calls; a real remote smoke run remains a separate rollout check.

## Affected Packages

None. Changes are confined to GitHub tooling, this specification folder, the parent specification,
and one `.gitignore` exception to make the new JSON policy trackable.
