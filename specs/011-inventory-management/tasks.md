# Tasks: Inventory Management

**Input**: Design documents from `specs/011-inventory-management/` (`spec.md`, `plan.md`)
**Tests**: Include focused unit/integration tests because this feature changes checkout behavior.

## Phase 1: Setup

- [x] T001 Add inventory API route registration in `packages/api/src/api/v3/inventory.ts`
- [x] T002 Register inventory routes from the API v3 router

## Phase 2: Foundational (blocking prerequisites)

- [x] T003 Add stock fields to `packages/api/src/models/Product.ts`
- [x] T004 Add stock movement persistence model in `packages/api/src/models/StockMovement.ts`
- [x] T005 Add inventory adjustment and stock decrement logic in `packages/api/src/services/InventoryService.ts`

## Phase 3: Core Implementation

- [x] T006 Add stock checks/decrements to checkout/order creation code in `packages/api/src/api/v3/orders.ts` and related order service code
- [x] T007 [P] Add admin inventory management UI in `packages/web/src/adminPages.tsx`
- [x] T008 [P] Add checkout stock feedback in `packages/web/src/cartPage.tsx`
- [x] T009 Add API client helpers for inventory operations in `packages/web/src/api.ts`

## Phase 4: Tests

- [x] T010 Add inventory adjustment tests in `packages/api/tests/unit/inventory.test.ts`
- [x] T011 Add checkout stock decrement and insufficient-stock tests in the relevant API test suite
- [x] T012 Add a concurrent checkout test that verifies stock cannot go negative

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T013 Confirm inventory APIs require admin role checks where appropriate
- [x] T014 Run build/test checks for the touched API and web packages

Validation:

- `npm run build`: passed for all workspaces.
- `npm test`: 131 tests passed.
- `npm run lint`: passed with 8 existing warnings and no errors.
- `npx --no-install tsc --noEmit -p packages\web\tsconfig.json`: passed.
- `npm run test:e2e -w @iwa/api -- --grep "adds products to the React cart|admin inventory adjustments|cart ignores"`:
  3 browser tests passed; the test server also builds all workspaces.

The full browser suite was not run.

The browser regression deliberately delays a discarded initial cart load to verify that it cannot
overwrite an edited quantity. The stock-error test verifies that quantities survive rejected checkout.

## Dependencies

- Phase 2 blocks Phase 3
- Phase 3 blocks Phase 4
- Phase 5 runs last