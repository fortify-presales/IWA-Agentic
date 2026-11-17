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

- AI assistance used: <!-- none | low | significant | predominant -->
- AI tool: <!-- GitHub Copilot | other | none -->
- AI-generated code manually reviewed: <!-- yes | no | not-applicable -->

## Security impact

- Security-sensitive code generated or modified: <!-- yes | no -->
- Authentication or authorization changed: <!-- yes | no -->
- Secrets, tokens, credentials, or vault access changed: <!-- yes | no -->
- New or materially changed API: <!-- yes | no -->
- New integration or trust boundary: <!-- yes | no -->
- New dependency introduced: <!-- yes | no -->
- Internet-facing behaviour changed: <!-- yes | no -->
- Sensitive data processing changed: <!-- yes | no -->
- Previous security incident area changed: <!-- yes | no -->
