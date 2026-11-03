# Implementation Plan: Headless Inventory Reordering Agent

**Branch**: `019-headless-inventory-agent` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/019-headless-inventory-agent/spec.md`

## Summary

Add a separately runnable worker that schedules bounded inventory-review jobs, invokes an LLM-backed
tool loop, records job progress and tool outcomes, and creates purchase orders only in a local
simulated supplier. Reuse the stock and movement services from `011-inventory-management`; do not
change the existing chat agent's runtime or make its tools available to the worker by default. Keep
model construction lazy so the main API can start without worker credentials. Add deterministic
test doubles and preserve three narrowly scoped, explicitly marked vulnerability demonstrations:
business-data prompt injection, excessive purchasing authority, and duplicate simulated orders after
retry.

## Technical Context

- **Affected packages**: `@iwa/agent`, `@iwa/api`, `@iwa/web`
- **Dependencies added/changed**: none expected; reuse the current LangChain/OpenAI and persistence
  stack unless implementation discovery demonstrates a concrete gap.
- **Data model changes**: Add durable worker-run state and simulated purchase-order records with
  order lines, status, timestamps, and a run reference. Reuse product stock and stock-movement data
  from `011-inventory-management`.
- **Unknowns**: The feature depends on `011-inventory-management` being implemented first. Confirm
  its final service/model APIs before coding this feature; do not assume the draft paths or contracts
  are already present.

## Constitution Check

*GATE: must pass before implementation starts; re-check if the plan changes materially.*

- [x] **I. Intentional Insecurity Is Sacrosanct** — no existing `INSECURE:` marker, vulnerability
      table entry, or pinned vulnerable dependency is fixed, removed, or weakened by this plan.
- [x] **II. Documented Vulnerability Lifecycle** — this feature intentionally introduces
      demonstrations; marker comments, `publicPages.tsx` entries, regression tests, and exact
      `DEMO.md` payloads are scheduled as tasks.
- [x] **III. Monorepo Workspace Boundaries** — changes stay within existing workspaces and preserve
      package build order; no path options are added to `tsconfig.base.json`.
- [x] **IV. Fault-Tolerant Runtime Configuration** — model configuration is optional and loaded
      lazily by the worker; missing credentials do not fail API startup.
- [x] **V. Fixable Bugs vs. Preserved Vulnerabilities** — intentional weaknesses remain marked and
      reproducible; unrelated vulnerabilities are not remediated.

## Project Structure

### Documentation (this feature)

```text
specs/019-headless-inventory-agent/
├── spec.md
├── plan.md
└── tasks.md
```

### Source code (repository root)

```text
packages/
├── agent/src/HeadlessInventoryAgent.ts
├── agent/src/tools/                  # Inventory and simulated reorder tool contracts
├── api/src/models/                    # Durable worker-run and simulated order records
├── api/src/services/                  # Run persistence and simulated purchasing
├── api/src/workers/                   # Scheduler and independently runnable worker entry
├── api/tests/                         # Worker, persistence, retry, and vulnerability tests
└── web/src/publicPages.tsx            # Vulnerability catalog entries
```

The exact persistence and scheduler files should follow the existing package patterns discovered
during implementation. Do not add a user-facing assistant route or a real supplier adapter.

## Implementation Order

1. Verify and implement against the completed inventory contracts from `011-inventory-management`.
2. Add durable run and simulated purchase-order persistence, including an explicit retry/resume state
   model.
3. Add dependency-injected inventory/reorder tools and a separate bounded headless agent loop; leave
   the existing `AgentService.chat()` behavior unchanged.
4. Add an independently runnable scheduled worker with lazy model configuration, structured status
   reporting, and deterministic test injection.
5. Add focused worker, restart/retry, and simulated-supplier tests; then add intentional-vulnerability
   markers, regression tests, catalog entries, and exact `DEMO.md` demonstrations.
6. Build affected workspaces and run focused API tests.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|---------------------------------------|
| Separate worker entry point and durable job state | Scheduled work must continue independently of a chat/API request and be inspectable after restart. | Running the entire agent inside a request would not demonstrate headless execution or resumable jobs. |
