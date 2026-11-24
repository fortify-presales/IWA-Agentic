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

## FAA risk scoring

FAA risk scoring may invoke a PR differential scan. The score considers labels, changed paths,
change size, and recognized Copilot-authored PRs. For the declarations below, only
significant/predominant AI assistance, unreviewed AI-generated code, and security-sensitive
changes add points; missing or unrecognized answers do not. Bot authorship does not detect AI
assistance in human-authored PRs.

## AI assistance

<!-- Replace each answer comment with one listed value; keep the field labels unchanged. -->

Use `none` for no AI, `low` for minor suggestions, `significant` for substantial help, or
`predominant` when AI produced most of the change. For manual review, use `yes` only if a human
reviewed all AI-generated code, `no` if that review is incomplete, or `not-applicable` if none
was generated. AI review, tests, and scans do not count as human review.

- AI assistance used: <!-- none | low | significant | predominant -->
- AI tool: <!-- GitHub Copilot | other | none -->
- AI-generated code manually reviewed: <!-- yes | no | not-applicable -->

## Security impact

<!-- Replace each answer comment with one listed value; keep the field labels unchanged. -->

Answer for the whole PR, including CI, scripts, credentials, and trust boundaries. If unsure,
investigate or ask; don't default to `no`. FAA path evidence scores independently and is not
overridden by declarations.

- Security-sensitive code generated or modified: <!-- yes | no -->
- Authentication or authorization changed: <!-- yes | no -->
- Secrets, tokens, credentials, or vault access changed: <!-- yes | no -->
- New or materially changed API: <!-- yes | no -->
- New integration or trust boundary: <!-- yes | no -->
- New dependency introduced: <!-- yes | no -->
- Internet-facing behaviour changed: <!-- yes | no -->
- Sensitive data processing changed: <!-- yes | no -->
- Previous security incident area changed: <!-- yes | no -->
