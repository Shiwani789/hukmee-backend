# HUKMEE backend architecture

## Phase 0 finding

No SOW, PRD or approved workflow document was found in the HUKMEE project or its `sardar` parent. The two pasted briefs are the current sources. Requirements are traced in `requirements-matrix.md`; policy questions are in `open-business-decisions.md`. This architecture is proposed, not client approval of operational rules.

## System shape

Use a modular monolith and one PostgreSQL source of truth. Keep HTTP adapters thin; put ownership checks, policies, transactions and state transitions in module services. External integrations are adapters and cannot fabricate success.

```text
Flutter user/vendor apps / Next.js website and Admin
                       | HTTPS /api/v1 + OpenAPI
                       v
 Express 5: correlation -> security -> auth -> validation -> routes
                       v
 Modular services: identity | catalogue | user | booking | repair
                  inventory | finance | support | admin
                       v
       Prisma + PostgreSQL (business, event and audit records)
          |                                  |
 S3-compatible private media       OTP / messaging / payment adapters
```

Redis and workers are added only if a confirmed asynchronous workload requires durable queuing. No microservices or realtime sockets are proposed for the available scope.

## Module ownership

- **Platform:** environment validation, Prisma lifecycle, request IDs, structured logging, HTTP error mapping, pagination, health/readiness, OpenAPI.
- **Identity/access:** users, sessions, OTP/reset challenges, roles, permissions, account states and guards.
- **User/device:** profiles, addresses, catalogue device models and owned devices.
- **Catalogue:** categories/services, compatibility, pricing and warranty policies. Preserve booking/estimate snapshots across edits.
- **Vendor:** technician/vendor account, restricted KYC, approval history, skills, service area and availability.
- **Booking/scheduling:** requests, slot capacity, booking history, cancellation and rescheduling.
- **Assignment:** eligible vendor offers and assignment history, independent from booking state.
- **Repair workflow:** repair job, arrival, inspection/evidence, estimates/decisions, repair execution, QC, handover, warranty, escalation and custody.
- **Hub inventory:** compatible parts, hub balances, append-only ledger, repair part requests/issues/returns. Separate from optional accessory commerce.
- **Finance:** payment attempts, verified webhook events, refunds and financial audit. Do not derive unapproved taxes, commissions or payouts.
- **Support/notifications:** tickets/comments/events and in-app/provider delivery history. Provider failure does not roll back domain transactions.
- **Admin/reporting:** permission-guarded APIs use the same domain services and database; reports derive from persisted rows.

## Data and security invariants

- UUID primary keys and timestamps; index ownership, status and time queries. Normalize catalogue and compatibility relations.
- Restrict deletion of repair, financial, inventory, audit and custody history. Deactivate accounts/catalogue rather than breaking referenced records.
- Store media metadata/private keys in PostgreSQL and bytes in private S3-compatible storage.
- Persist only hashes of refresh tokens and OTPs. Mask credentials, KYC, private identifiers and payment data in logs.
- Use transactions/conditional writes for slot reservation, state transitions, inventory, estimate decisions and payment/refund reconciliation.
- Apply idempotency keys to retry-sensitive writes. Preserve attempts, decisions and stock/payment history as append-only records.
- Keep booking, assignment, job, estimate, payment, part request, QC and warranty state dimensions independent.
- A payment is successful only after trusted provider verification; no frontend success flag is authoritative.

## API conventions

Version routes under `/api/v1`; return `{ data, meta? }` or the standard error fields `{ success: false, message, code, errors?, requestId? }`. Error responses also include the historical `error` object (with `details` for validation data) as a compatibility alias for existing clients. Validate path/query/body with Zod. Bound page size and allow-list sort fields. Apply resource ownership in the service query. Enforce permissions server-side for every admin operation. Keep liveness separate from readiness.

## Integration and deployment boundary

OTP, email/SMS/push, payment and storage require configured adapters. Storage must be private with validated uploads and short-lived URLs. Use separate development/test/production settings and a dedicated HUKMEE database/role. No existing database is used. Production secrets come from a secrets manager. Retention, region, backup/RPO/RTO and observability need deployment decisions.
