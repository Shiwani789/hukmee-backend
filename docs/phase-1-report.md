# Phase 1 implementation report

**Status:** Local source baseline stabilized; Phase 1 identity/RBAC is partially complete. This report supersedes the earlier report in this checkout, whose file and validation claims did not match the source present at the start of this implementation pass.

## Implemented

- Reconciled the Express bootstrap imports with existing feature routes and removed unresolved references to legacy middleware, database, order, and bcrypt modules.
- User registration creates one Prisma `User` with profile fields and a direct `USER` role relation. Passwords use Argon2id; public responses exclude password hashes.
- Password login returns a short-lived HS256 access token tied to a persisted session and an opaque refresh token whose SHA-256 digest is stored.
- Refresh rotation uses a conditional database update; reusing a rotated token revokes its session and records an audit event.
- Current-user/session listing, current-session logout, logout-all, and own-session revocation are implemented with ownership checks.
- OTP challenges use random six-digit codes, HMAC digests, configured expiry/attempt limits and an authenticated HTTP delivery adapter. No fixed OTP is present. OTP remains disabled until provider and policy settings are configured. Verification uses conditional one-time consumption; password reset and session revocation are transactional.
- Active device-brand/model/service read endpoints, authenticated user-owned device endpoints, compatible `REQUESTED` repair request endpoints, and permission-gated technician assignment use existing Prisma models.
- Shared validation stores parsed input, errors use the existing API envelope, auth responses are no-store, and active endpoints are represented in Swagger.
- OAuth is not mounted because provider, callback and account-linking rules are not configured. The previous OAuth code referenced unavailable legacy models/dependencies.

## Not implemented / policy boundary

The auth schema now supports `SUPER_ADMIN`, `ADMIN`, `USER`, `VENDOR`, `WORKER`, and `DELIVERY_PARTNER` with Constructor-style direct user-role and role-permission relations. The project does not yet define all requested role permissions, service areas/slots, price snapshots, demand capture, full repair progression, payments, inventory operations, QC, warranty, service-centre custody, finance, complaints or notifications. Booking creation is only a request; it does not confirm availability or price.

The Master PRD/SOW and Postman collection were unavailable. The implementation follows the repository authentication contract and the user-pasted prompt; unresolved commercial, tax and operational decisions remain in `docs/OPEN_DECISIONS.md`.

## Validation in this checkout

- `DATABASE_URL=postgresql://hukmee:unused@localhost:5432/hukmee_audit npm run build` — passed; Prisma Client generation and TypeScript compilation passed. The placeholder URL was not contacted.
- `npm run lint` — passed.
- `npm test -- --runInBand` — passed after running with local ephemeral HTTP binding: 2 suites passed, 9 tests passed, 1 database integration suite skipped. The skip is expected without a dedicated `TEST_DATABASE_URL`.
- `DATABASE_URL=postgresql://hukmee:unused@localhost:5432/hukmee_audit npx prisma validate` — passed; no database connection.
- No migration, database write, reset, or integration DB connection was performed.

## Remaining Phase 1 tasks

- Run the opt-in integration test against a dedicated migrated `*_test` database when available.
- Expand role/permission and cross-resource denial tests after the business role mapping is approved.
- Verify OTP delivery, attempt policy and recovery behavior with the approved provider configuration.
- Run the declared Node.js 22 CI environment; current available runtime is Node.js 24.

See [implementation roadmap](IMPLEMENTATION_ROADMAP.md) for the next phase.
