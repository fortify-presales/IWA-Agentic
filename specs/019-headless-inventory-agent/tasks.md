# Tasks: Headless Inventory Reordering Agent

**Input**: Design documents from `specs/019-headless-inventory-agent/` (`spec.md`, `plan.md`)
**Tests**: Include worker, persistence, retry/resume, and vulnerability regression tests.

## Prerequisites

- [ ] T001 Complete `specs/011-inventory-management/` in full, including stock adjustment and
  movement history, checkout stock decrement and insufficient-stock behavior, concurrency
  protection, admin UI, checkout feedback, and focused tests. Confirm its final inventory service
  and model contracts before integrating the worker.

## Phase 1: Setup

- [ ] T002 Confirm package entry-point, persistence, and worker-start conventions in
  `packages/api/package.json`, `packages/api/src/index.ts`, and deployment files. The scheduled
  worker must share the API process/container and local database; do not add a second long-running
  service.
- [ ] T003 Define worker settings and optional model-credential behavior in
  `packages/api/src/config/env.ts` without making API startup depend on LLM credentials.

## Phase 2: Foundational

- [ ] T004 Add durable run and simulated purchase-order models in
  `packages/api/src/models/InventoryAgentRun.ts` and
  `packages/api/src/models/SimulatedPurchaseOrder.ts`.
- [ ] T005 Add run lifecycle and simulated order persistence in
  `packages/api/src/services/InventoryAgentRunService.ts` and
  `packages/api/src/services/SimulatedSupplierService.ts`.
- [ ] T006 Define typed inventory and simulated supplier tool contracts in
  `packages/agent/src/tools/inventoryAgentTools.ts` and export only the interfaces required by the
  worker.

## Phase 3: Core Implementation

- [ ] T007 Implement bounded headless model/tool orchestration in
  `packages/agent/src/HeadlessInventoryAgent.ts`, recording each action and stopping on completion,
  error, or configured limits.
- [ ] T008 Implement scheduled job creation, polling, restart handling, bounded retries, and
  graceful start/stop lifecycle in `packages/api/src/workers/InventoryAgentScheduler.ts`; integrate
  the optional scheduler with API startup and shutdown in `packages/api/src/index.ts`.
- [ ] T009 Add a one-shot CLI entry point in `packages/api/src/workers/inventoryAgentWorker.ts` and
  a start script in `packages/api/package.json` that invoke the same worker path. Do not configure
  or deploy a second long-running worker service.
- [ ] T010 Connect `packages/agent/src/HeadlessInventoryAgent.ts` to the inventory service from
  `011-inventory-management` and `packages/api/src/services/SimulatedSupplierService.ts`; do not
  add real outbound supplier calls.
- [ ] T011 Add deterministic fake-model and fake-supplier tests for low-stock decisions, no-op runs,
  terminal states, and persisted outcomes.
- [ ] T012 Add restart/resume and retry tests that exercise partial failure and verify the specified
  duplicate-order demonstration.

## Phase 4: Vulnerability Documentation

- [ ] T013 Add `INSECURE:`/`Purpose:`/`Fix:` markers immediately above the three vulnerable
  boundaries: untrusted business data to model context, autonomous simulated purchasing without an
  independent approval/policy check, and non-idempotent retry behavior.
- [ ] T014 Add focused regression tests in `packages/api/tests/vulnerabilities/` for prompt injection,
  excessive purchasing authority, and duplicate simulated orders.
- [ ] T015 Add matching entries to the vulnerabilities table in
  `packages/web/src/publicPages.tsx`.
- [ ] T016 Document exact deterministic payloads, setup, trigger, and expected simulated results in
  `DEMO.md`.

## Phase 5: Polish & Validation

- [ ] T017 Document worker start/stop behavior, schedule configuration, optional LLM setup, job
  inspection, retry limits, same-container deployment, single-instance scheduling constraint,
  one-shot CLI use, and the simulated-only supplier boundary in `README.md` or the repository's
  relevant operator documentation.
- [ ] T018 Verify that no worker path can call a real supplier or external network, missing model
  credentials do not prevent API startup, and the disabled scheduler does not start with the API.
- [ ] T019 Build the affected workspaces and run focused inventory-agent and vulnerability tests.

## Dependencies

- T001 blocks T004, T005, T008, and T010.
- T002 blocks T003 and T008.
- T003, T004, and T005 block T008.
- T006 blocks T007 and T010.
- T007, T008, and T010 block T009.
- T007, T008, T009, and T010 block T011 and T012.
- T011 and T012 block T013.
- T013 blocks T014.
- T014 blocks T015 and T016.
- T017-T019 run after core implementation and vulnerability documentation.
