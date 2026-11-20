# Implementation Plan: Headless Inventory Reordering Agent

**Branch**: `019-headless-inventory-agent` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/019-headless-inventory-agent/spec.md`

## Summary

Add an opt-in scheduler inside the API process and its existing container. It schedules bounded
inventory-review jobs, invokes an LLM-backed tool loop, records job progress and tool outcomes, and
creates purchase orders only in a local simulated supplier. Provide a one-shot CLI entry point that
uses the same worker path. Reuse the completed stock and movement services from
`011-inventory-management`; do not change the existing chat agent's runtime or make its tools
available to the worker by default. Keep model construction lazy so the main API can start without
worker credentials. Add deterministic test doubles and preserve three narrowly scoped, explicitly
marked vulnerability demonstrations: business-data prompt injection, excessive purchasing authority,
and duplicate simulated orders after retry.

## Technical Context

- **Affected packages**: `@iwa/agent`, `@iwa/api`, `@iwa/web`
- **Dependencies added/changed**: none expected; reuse the current LangChain/OpenAI and persistence
  stack unless implementation discovery demonstrates a concrete gap.
- **Data model changes**: Add durable worker-run state and simulated purchase-order records with
  order lines, status, timestamps, and a run reference. Reuse product stock and stock-movement data
  from the fully implemented `011-inventory-management`.
- **Runtime**: Start the scheduler from the API bootstrap only when enabled; stop it during graceful
  shutdown. Run it in the existing application container to share the API's local SQLite persistence.
  Do not add a second long-running worker service. The standalone CLI is for one-shot controlled
  runs only.
- **Deployment constraint**: The scheduler assumes a single API process uses the SQLite database.
  Horizontal scheduling across multiple API instances is out of scope unless a distributed lease is
  designed.
- **Unknowns**: None expected after `011-inventory-management` is fully implemented and its final
  service/model APIs are confirmed.

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
├── api/src/workers/                   # Scheduler and one-shot CLI entry point
├── api/src/index.ts                   # Optional scheduler lifecycle with API startup/shutdown
├── api/tests/                         # Worker, persistence, retry, and vulnerability tests
└── web/src/publicPages.tsx            # Vulnerability catalog entries
```

The exact persistence and scheduler files should follow the existing package patterns discovered
during implementation. Do not add a user-facing assistant route or a real supplier adapter.

## Implementation Order

1. Complete `011-inventory-management` in full, including admin inventory operations, checkout
   decrement/insufficient-stock behavior, concurrency protection, UI feedback, and tests. Confirm
   the final inventory service and model contracts before starting 019.
2. Add durable run and simulated purchase-order persistence, including an explicit retry/resume state
   model.
3. Add dependency-injected inventory/reorder tools and a dedicated bounded headless agent loop; leave
   the existing `AgentService.chat()` behavior unchanged.
4. Add a configurable scheduler lifecycle to the API bootstrap, with lazy model configuration,
   structured status reporting, graceful shutdown, and deterministic test injection. Add a one-shot
   CLI entry point using the same worker path; do not add a second long-running container/service.
5. Add focused worker, restart/retry, and simulated-supplier tests; then add intentional-vulnerability
   markers, regression tests, catalog entries, and exact `DEMO.md` demonstrations.
6. Build affected workspaces and run focused API tests.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|---------------------------------------|
| Durable job state and a one-shot CLI entry point | Scheduled work must run independently of chat requests and remain inspectable after restart; the CLI enables a controlled run without starting a second long-lived process. | A separate container would complicate access to the API's SQLite database and create duplicate-scheduler/locking risks. |
