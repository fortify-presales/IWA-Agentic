# Feature Specification: Headless Inventory Reordering Agent

**Status**: Draft | **Branch**: `019-headless-inventory-agent` | **Date**: 2026-11-03
**Input**: Request to add a headless autonomous agent that monitors stock and simulates product reordering.

## Overview

Add a background agent that periodically reviews product inventory, decides whether products need
reordering, and submits simulated purchase orders to a local demo supplier. When enabled, its
scheduler runs inside the API process in the same container as the web application and SQLite
database; it does not require a separate long-running Railway service or container. A one-shot CLI
entry point uses the same worker path for controlled runs. The worker runs without a chat session or
user prompt, persists its execution and order outcomes, and exposes enough status and audit
information to make its decisions reproducible. It intentionally demonstrates security risks from
autonomous model decisions and persistent execution; it MUST NOT connect to a real supplier or place
real orders.

This feature builds on [011-inventory-management](../011-inventory-management/spec.md), which defines
stock levels and inventory movements, and complements [013-agentic-excessive-agency](../013-agentic-excessive-agency/spec.md)
with an autonomous, background state-changing workflow. It is separate from the user-facing chat tools
in [002-agent-assistant](../002-agent-assistant/spec.md) and [017-agent-tool-expansion](../017-agent-tool-expansion/spec.md).
The indirect-injection scenario extends the data trust-boundary example in
[014-business-data-prompt-injection](../014-business-data-prompt-injection/spec.md).

## Is this an intentional vulnerability demonstration?

- [ ] No — this is a normal feature/fix.
- [x] Yes — see Constitution Principle II (Documented Vulnerability Lifecycle). If yes, fill in:
  - **CWE**: CWE-1427, CWE-862, CWE-841
  - **Purpose**: Demonstrate indirect prompt injection from inventory/business data, autonomous
    purchase actions without independent approval or authorization limits, and duplicate simulated
    orders when a worker retries or resumes a partially completed job.
  - **Fix**: Treat product and supplier text as untrusted data; validate reorder decisions against
    deterministic server-side policies; require approval and enforce role, quantity, and spend limits;
    make order submission idempotent and persist tool effects atomically with job progress.
  - Confirms: `publicPages.tsx` table entries, regression tests under
    `packages/api/tests/vulnerabilities/`, and `DEMO.md` entries with exact payloads are all planned
    in this spec's tasks.

## User Scenarios

### Primary scenario

Given the worker is enabled and products have inventory data, when a scheduled inventory check runs,
then the agent evaluates stock, may submit a simulated reorder, and records the decision, tool calls,
and outcome for later inspection.

### Additional scenarios

- Given a product is below its reorder threshold, when the agent completes a run, then a simulated
  purchase order records the selected product, quantity, and supplier.
- Given a run is interrupted and resumed, when the worker continues it, then the job's state and
  prior actions are visible and the run eventually reaches a terminal status.
- Given a product description contains instructions aimed at the agent, when the agent reviews the
  product, then the deterministic demo fixture can reproduce the resulting unsafe tool choice.
- Given a model credential is missing, when the API starts, then unrelated application routes remain
  available and the inventory worker reports a clear disabled or failed state rather than crashing
  the process.
- Given the worker is disabled, when the API starts, then no scheduler is started and the web
  application remains available.
- Given a demo operator requests an immediate run, when the one-shot CLI or test trigger is used,
  then the same worker path runs without requiring a chat UI or a real supplier.

### Edge cases

- A failed model or simulated supplier call is recorded with an actionable error and can be retried
  under the configured retry policy.
- A worker restart does not silently discard a running job; the persisted job can be resumed or marked
  failed according to the retry policy.
- When scheduling is enabled, only one API process may run the scheduler against the SQLite database;
  horizontal multi-instance scheduling requires a distributed lease and is out of scope.
- A single run has configured step, duration, and retry limits so a faulty model response cannot create
  an unbounded loop.
- A job with no low-stock products completes without creating a purchase order.
- The simulated supplier never performs outbound network requests or real-world transactions.

## Functional Requirements

- **FR-001**: When `INVENTORY_AGENT_ENABLED=true`, the API process MUST start a headless scheduler
  in the same container as the web application and SQLite database. It MUST run inventory checks on
  a configurable schedule without requiring a user chat request. The scheduler MUST be disabled by
  default and MUST stop with the API process.
- **FR-002**: The system MUST persist each run's identifier, status, timestamps, decision summary,
  tool-call inputs and outputs, and errors so completed and interrupted work can be inspected.
- **FR-003**: The agent MUST use the inventory data and stock-management operations established by
  `011-inventory-management`; it MUST NOT duplicate or bypass that spec's stock accounting logic.
- **FR-004**: The agent MUST be able to create a simulated purchase order containing supplier,
  product lines, quantities, and a stable reference, with no live supplier integration or payment.
- **FR-005**: The worker MUST support bounded execution, explicit terminal states, controlled retries,
  and restart handling.
- **FR-006**: The scheduler lifecycle MUST be independently controlled by configuration and tied to
  API startup/shutdown. A one-shot CLI entry point MUST invoke the same worker path for controlled
  runs. Optional model credentials/configuration MUST NOT be required for API process startup.
- **FR-007**: A deterministic fixture or fake-model path MUST reproduce the key agent decisions and
  tool effects in automated tests without requiring a live LLM or network supplier.
- **FR-008**: The implementation MUST preserve the following intentional demonstrations:
  - **Indirect prompt injection (CWE-1427)**: product or supplier-controlled text is returned to the
    model without a reliable instruction/data boundary and can influence a purchase decision.
  - **Excessive agency (CWE-862)**: the agent can submit simulated purchase orders without an
    independent approval step or effective server-side role, quantity, or spend authorization.
  - **Duplicate action on retry (CWE-841)**: retrying or resuming after an order side effect can
    create a second simulated order for the same decision because the operation is not idempotent.
- **FR-009**: Each intentional weakness MUST have an `INSECURE:`/`Purpose:`/`Fix:` marker, a
  regression test, a vulnerability catalog entry, and an exact `DEMO.md` payload with expected
  results.
- **FR-010**: The worker MUST NOT expose a public chat interface or make real supplier requests.
- **FR-011**: The worker MUST use the same local persistence as the API and MUST NOT require a
  separate container, Railway service, or shared-volume arrangement.

## Out of Scope

- Real supplier APIs, external network access, payment, or actual purchasing.
- Changes to the user-facing chat assistant or its existing tool semantics.
- Replacing or weakening the inventory authorization, stock consistency, or checkout requirements
  defined by `011-inventory-management`.
- A general-purpose autonomous agent framework, long-term conversational memory, or arbitrary
  user-defined goals.
- Horizontal multi-instance scheduling, distributed leader election, or a move from SQLite to a
  network database.
- A web dashboard; run status and decisions are observable through persisted records, structured
  logs, and focused test/demo tooling.

## Success Criteria

- **SC-001**: With the worker enabled in the API process, a scheduled or controlled test run inspects
  inventory and reaches a persisted terminal status without a chat request; with it disabled, API
  startup does not start the scheduler.
- **SC-002**: A below-threshold product can result in a persisted simulated purchase order, while no
  real supplier endpoint is contacted.
- **SC-003**: A deterministic test reproduces each of the three intentional vulnerability scenarios
  and confirms its observable result.
- **SC-004**: An interrupted run can be inspected and resumed or marked failed under the configured
  bounded retry policy.
- **SC-005**: Missing optional LLM configuration does not prevent the main API process from starting.

## Affected Packages

- [ ] `packages/shared` — no user-facing chat contract is required; add shared job types only if
  needed by existing package boundaries.
- [x] `packages/agent` — headless model/tool orchestration and dependency-injected inventory tools.
- [x] `packages/api` — durable job and simulated purchase-order persistence, API-integrated scheduler,
  one-shot CLI entry point, inventory/supplier callbacks, tests, and vulnerability markers.
- [x] `packages/web` — vulnerability catalog entries only; no agent UI.
