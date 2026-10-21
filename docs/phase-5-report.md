# Phase 5 implementation report

## Implemented supported scope

- `GET /api/v1/inventory/hubs` lists active hubs.
- `GET /api/v1/inventory/hubs/:hubId/stock` lists current quantities for active parts at an active hub.
- `GET /api/v1/inventory/hubs/:hubId/movements?limit=50&cursor=<uuid>` reads newest-first movement history with bounded cursor pagination. Cursor IDs are checked against the selected hub.
- All inventory routes require the existing `inventory:manage` permission. Responses are read-only and use existing Prisma records.
- Added request validation, API documentation, README, roadmap and requirements-matrix updates.
- Added service/API tests for permission denial, inactive hubs, active-part stock filtering, invalid IDs, pagination bounds and cursor ownership.

## Not implemented and why

- Payment creation/status, provider callbacks, webhooks, refunds and cash collection: no provider configuration, currency/pricing source, idempotency contract, refund status model or approved financial policy is available. Payment records remain visible in user booking details.
- Stock adjustment, transfer, issue, return, part requests and reconciliation: current schema has quantity and movement records, but no hub-scoped roles, authorization scope, approval/separation-of-duty policy, reservation semantics or approved transition policy. Mutating inventory without these could corrupt stock history.
- No Prisma schema/migration or database data was changed.

The Master PRD/SOW and Postman collection were unavailable. Open decisions OD-05 through OD-10 and OD-19 remain relevant to the deferred payment and inventory mutations.

## Validation

- Prettier check — passed.
- `npm run lint` — passed.
- `DATABASE_URL=postgresql://hukmee:unused@localhost:5432/hukmee_audit npm run build` — passed; the placeholder URL was not contacted.
- `tests/inventory.service.test.ts` and `tests/inventory.api.test.ts` pass (6 tests). These use mocked Prisma and do not verify database persistence. No database connection, migration, reset, or data change was performed.

## Next steps

1. Verify reads against a dedicated, already-migrated `*_test` database when one is explicitly configured.
2. Approve hub roles/scopes, movement types and adjustment/transfer/issue/return rules before implementing writes.
3. Configure an approved payment provider and settle amount/currency, webhook signature/idempotency, cash and refund rules before payment mutations.
4. Verify all Phase 5 reads and later authorized mutations against a dedicated, already-migrated `*_test` database.
