# Spec-Driven Development

This repo uses a lightweight, hand-authored adaptation of spec-driven development (inspired by
[github/spec-kit](https://github.com/github/spec-kit), without depending on its CLI).

## Layout

```text
specs/
├── memory/constitution.md      # Project principles — read this first
├── templates/
│   ├── spec-template.md        # Copy for a new feature's spec.md
│   ├── plan-template.md        # Copy for a new feature's plan.md
│   └── tasks-template.md       # Copy for a new feature's tasks.md
└── <NNN>-<feature-slug>/       # One folder per feature, e.g. 001-agent-rate-limit/
    ├── spec.md
    ├── plan.md
    └── tasks.md
```

## Workflow

1. **Spec**: copy `templates/spec-template.md` to `specs/<NNN>-<slug>/spec.md` and fill it in.
2. **Plan**: copy `templates/plan-template.md` to `specs/<NNN>-<slug>/plan.md`, run through the
   Constitution Check gate against [`memory/constitution.md`](memory/constitution.md).
3. **Tasks**: copy `templates/tasks-template.md` to `specs/<NNN>-<slug>/tasks.md`, break the plan
   into checklist tasks, and check them off as you implement.
4. Reference the `specs/<NNN>-<slug>/` folder in the related issue and PR for traceability (see
   `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md`).

`<NNN>` is a zero-padded sequential number (`001`, `002`, ...); `<slug>` is a short kebab-case name.
The next new spec must use `020`; do not reuse the unused `015` number.

Spec folders stay flat and are never moved when their status changes, so links from issues, PRs and
other specs remain valid. Track progress with the `**Status**` line in each `spec.md` and the index
below.

## Status values

| Status | Meaning |
| --- | --- |
| `Draft` | Spec written; not yet approved or started. |
| `Implementing` | Work in progress; some `tasks.md` items are unchecked. |
| `Implemented` | All in-scope tasks are checked and merged. |
| `Superseded` | Replaced by a later spec (name it in the spec). |
| `Withdrawn` | Abandoned; kept for history. |

When you change a spec's status, update its `**Status**` line and this index in the same PR.

## Index

| Spec | Title | Status | Vulnerability demo | Notes |
| --- | --- | --- | --- | --- |
| [001](001-product-reviews/spec.md) | Product Reviews | Implemented | Yes | |
| [002](002-agent-assistant/spec.md) | Conversational AI Assistant (Olive) | Implemented | Yes | |
| [003](003-file-operations/spec.md) | File Operations | Implemented | Yes | |
| [004](004-order-management/spec.md) | Order Management | Implemented | Yes | |
| [005](005-admin-diagnostics/spec.md) | Admin Diagnostics | Implemented | Yes | |
| [006](006-auth-mfa/spec.md) | Authentication and MFA | Implemented | Yes | Completed by 018. |
| [007](007-messaging/spec.md) | User Messaging | Implemented | Yes | |
| [008](008-wishlist-favorites/spec.md) | Wishlist and Favorites | Draft | Yes | |
| [009](009-discount-codes/spec.md) | Discount Codes and Promotions | Draft | Yes | |
| [010](010-returns-refunds/spec.md) | Returns and Refunds | Draft | Yes | |
| [011](011-inventory-management/spec.md) | Inventory Management | Draft | No | Prerequisite for 019. |
| [012](012-notification-templates/spec.md) | Notification Templates | Draft | Yes | |
| [013](013-agentic-excessive-agency/spec.md) | Agentic Excessive Agency Demonstration | Implemented | Yes | |
| [014](014-business-data-prompt-injection/spec.md) | Indirect Prompt Injection Through Business Data | Implemented | Yes | |
| [016](016-mcp-agent-tools/spec.md) | MCP Agent Security Feasibility | Implemented | No | Documentation only; MCP implementation tasks are deferred. |
| [017](017-agent-tool-expansion/spec.md) | Consolidated Agent Tool Expansion | Implemented | Yes | |
| [018](018-mfa-completion/spec.md) | MFA Completion (Email, SMS, TOTP) | Implemented | Yes | |
| [019](019-headless-inventory-agent/spec.md) | Headless Inventory Reordering Agent | Draft | Yes | Requires 011. |
| [099](099-fortify-demo-workflows/spec.md) | Fortify Demo Workflows | Implemented | Yes | |

Number `015` is unused and reserved as a gap; new specs continue at `020`.
