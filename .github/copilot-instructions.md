# Copilot Instructions for IWA-NodeJS

## ⚠️ CRITICAL: This is an Intentionally Vulnerable Application

**DO NOT** fix, sanitize, or harden any code marked as intentionally insecure.
**DO NOT** remove vulnerability marker comments.
**DO NOT** update deliberately pinned vulnerable dependencies listed in DEPENDENCIES.md.
**The only exception is if you are explicitly instructed to fix a vulnerability for demonstration purposes.**

## Vulnerability Marker Convention

Every intentional vulnerability MUST have this comment block immediately above it:

```typescript
// INSECURE: <one-line description of the vulnerability> (CWE-XX)
// Purpose: <what security tool or security lesson this demonstrates>
// Fix: <how a real production app would remediate this>
```

## Adding New Vulnerabilities

1. Add the marker comment as shown above.
2. Add the vulnerability to `packages/web/src/publicPages.tsx` (the `vulnerabilities` table rendered by `VulnerabilitiesPage`).
3. Add a regression test in `packages/api/tests/vulnerabilities/`.
4. Document it in `DEMO.md` with exact payloads and expected results.

Exception: Fortify Remediation Aviator branch-demo targets created from `demo-patches/fortify-remediate/` under `packages/api/src/remediationDemo/` are intentionally unmarked so Aviator can provide fix guidance for scanned findings. Do not add `INSECURE:` markers to those patch-created files. They may be exposed only under `/api/v3/remediation-demo` for SAST dataflow traceability, must not be linked from public UI, and should only be committed/remediated when explicitly demonstrating `/fortify-remediate`.

## Fortify Remediation Paths

When using `/fortify-remediate`, ScanCentral-created SAST finding paths may be prefixed with `Src/`. Treat this as packaging-only metadata: remove exactly one leading `Src/` segment before locating or editing the repository file. For example, remediate `Src/packages/api/src/services/StorageService.ts` as `packages/api/src/services/StorageService.ts`. Verify the normalized path exists before editing; do not remove or rewrite any other path segments.

## What IS OK to fix

- Bugs that prevent the app from starting or crashing unexpectedly (unless they are intentional).
- TypeScript compilation errors.
- Build configuration issues.
- Test infrastructure problems.
- Vulnerabilities that are intentionally added for demonstration purposes and are clearly marked as such.

## Spec-Driven Workflow

Non-trivial features should have a `specs/<NNN>-<feature-slug>/` folder with `spec.md`, `plan.md`,
and `tasks.md`, copied from `specs/templates/`. Read `specs/memory/constitution.md` first — it is
the source of truth for the principles condensed above. See `specs/README.md` for the full workflow.

## Commit Messages

Do not add `Co-authored-by` trailers or AI co-author attribution to suggested or created commit messages in this repository.

## Pull Request Declarations

- When drafting, creating or updating a PR description, use `.github/PULL_REQUEST_TEMPLATE.md`
  and preserve its headings, comments, checklist items and declaration field labels.
- Review the entire PR diff, including tooling and workflows. Populate AI-assistance and
  security-impact declarations only from verified evidence or explicit user answers.
- Before presenting a ready-to-submit description or publishing it, collect missing or uncertain
  declaration answers from the user. Do not silently leave answer placeholders or invent values.
- Always obtain explicit user confirmation of whether a human has reviewed all AI-generated code
  before answering the manual-review declaration. Agent review, tests and scans do not count as
  human review. Use `no` for incomplete human review and `not-applicable` only when no AI-generated
  code is present.
- If answers are unavailable, clearly identify the description as incomplete and list the
  unresolved declarations. Do not publish it as complete or replace unknown answers with `no`.
- Keep these guidance rules distinct from selection: the risk assessment is audit-only and does
  not block PR submission or merging. Only declarations configured in `.github/faa-policy.json`
  can affect the FAA score; missing or unrecognized answers add no points and are not recorded
  as `unknown`.
