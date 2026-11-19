## Summary

<!-- What does this PR do and why? -->

## Traceability

- Spec: `specs/[###-feature-slug]/spec.md` (or N/A for a small fix)
- Plan: `specs/[###-feature-slug]/plan.md` (or N/A)
- Tasks: `specs/[###-feature-slug]/tasks.md` (or N/A)
- Closes: #

## Checklist

- [ ] No documented/intentional vulnerability was fixed, sanitized, or removed (Constitution
      Principle I) — if this PR *intentionally* changes vulnerability behavior, that's called out
      above and reflected in `DEMO.md`.
- [ ] If this PR adds a new intentional vulnerability: `INSECURE:`/`Purpose:`/`Fix:` marker added,
      `packages/web/src/publicPages.tsx` table updated, regression test added under
      `packages/api/tests/vulnerabilities/`, and `DEMO.md` updated with exact payloads.
- [ ] `npm run build` and `npm run lint` pass locally.
- [ ] Relevant docs updated (`README.md`, `.env.example`, `DEMO.md`) if behavior/config changed.

## AI assistance

<!-- Replace each comment with one listed value. Declarations add context; they cannot lower automated risk. -->

**Before submitting:** Replace every answer placeholder in this section and Security impact
with exactly one listed value. Keep the field labels unchanged. Do not leave an HTML comment
as an answer. Complete all declarations for human review; the template does not enforce
completion.

For assistance level, use `none` for no AI assistance, `low` for minor suggestions,
`significant` for substantial assistance, or `predominant` when AI produced most of the change.
For manual review, use `yes` only when a human has reviewed all AI-generated code in this PR,
`no` if that review is incomplete, or `not-applicable` if there is no AI-generated code.
An AI review or a passing test/scan is not human manual review.

Configured risk criteria can select a PR-only differential FAA scan and import its results
into the branch's FoD/SSC target. Findings remain report-only, not automatically accepted.
Currently, FAA scoring uses only these declarations: significant/predominant AI assistance,
AI-generated code not manually reviewed, and security-sensitive code changed. Other
declarations provide context for human review but do not affect the FAA score. Missing or
unrecognized answers do not add points or produce an `unknown` status.

- AI assistance used: <!-- none | low | significant | predominant -->
- AI tool: <!-- GitHub Copilot | other | none -->
- AI-generated code manually reviewed: <!-- yes | no | not-applicable -->

## Security impact

Answer for the entire PR, including CI workflows, scripts, credentials and trust boundaries,
not only application code. If unsure, investigate or ask the author/reviewer rather than
defaulting to `no`. FAA path rules score independently: a negative declaration does not
cancel points from matching changed paths. The current adapter does not check for conflicts
between declarations and path evidence.

- Security-sensitive code generated or modified: <!-- yes | no -->
- Authentication or authorization changed: <!-- yes | no -->
- Secrets, tokens, credentials, or vault access changed: <!-- yes | no -->
- New or materially changed API: <!-- yes | no -->
- New integration or trust boundary: <!-- yes | no -->
- New dependency introduced: <!-- yes | no -->
- Internet-facing behaviour changed: <!-- yes | no -->
- Sensitive data processing changed: <!-- yes | no -->
- Previous security incident area changed: <!-- yes | no -->
