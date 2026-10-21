# HUKMEE repository audit

**Audit date:** 2026-10-16 (refreshed after address API work)  
**Workspace:** `/home/shiwani/Documents/backup/technologies/sardar/hukmee-backend`  
**Scope:** Read-only repository inspection and local validation; no database connection or migration was performed.

This began as the **Phase 0 starting-state snapshot**. The current implementation now also includes Phase 2–5 work and address CRUD, but the source/build state remains mixed. See [the updated requirements matrix](REQUIREMENTS_MATRIX.md) and [implementation roadmap](IMPLEMENTATION_ROADMAP.md) for current status.

## Repository identity and source limits

The requested fresh backend path is the current working directory. The repository contains a `.git` directory, but `git status` reports that the directory is not a Git worktree; no history or diff baseline could be used. No `AGENTS.md` was found. The repository has no checked-in Master PRD or SOW. The user-pasted master context is the only source reviewed for this audit; earlier discussion not present in the workspace was not treated as available evidence.

There is a notable documentation/code discrepancy: `docs/phase-1-report.md` says Phase 1 was implemented and validated, but the current source tree does not contain multiple files it says were added or updated. The current checkout, not that historical report, determines the status below.

## Stack and project files

- Runtime/framework: Node.js (package engine `>=22.18 <23`), TypeScript, Express 5.
- Package manager: npm; `package-lock.json` is present.
- Persistence: PostgreSQL with Prisma 6.19.0 (`prisma/schema.prisma`). One initial migration SQL file and migration lock exist. `prisma/seed.ts` is present.
- Supporting packages: Argon2, JWT, Zod, Pino, Helmet, CORS, express-rate-limit, Swagger UI/jsdoc.
- Tests: Jest, Supertest, ts-jest; API and auth test files exist.
- Environment: `.env.example` documents local database, JWT, CORS, logging, limits and optional OTP provider fields. No `.env` contents were read.
- Docs: README, architecture/authentication/API notes, requirements matrix, workflow/statuses, roadmap, open decisions and a Phase 1 report exist in lowercase naming. No Postman collection was found.

## Current source modules

The canonical app currently mounts auth, catalog, devices, bookings, inventory and address routers. Additional legacy module directories exist but are not mounted; their presence is not evidence of a functioning API. The current `npm run build` and `npm run lint` checks must be treated as failing until the incompatible legacy modules are reconciled.

`src/` currently contains:

- `app.ts`, `main.ts`
- `modules/auth/`: controller, routes, service, OAuth controller/service, OTP service
- `config/`, `middlewares/`, `utils/` and `types/`: env config, async handler, errors, logger, Prisma client, validation, auth/error/request-ID middleware

The README and bootstrap reference catalog, device and booking routers, but there are no corresponding feature source files in the current tree. The auth code imports legacy paths and types that are not present in this tree. This appears to be a partial/mixed snapshot; do not infer that documented routers are runnable APIs.

## Prisma inventory

Nine enums: `UserRole`, `AccountStatus`, `VendorKycStatus`, `VendorIdentityDocumentStatus`, `BookingStatus`, `AssignmentStatus`, `EstimateStatus`, `PaymentStatus`, and `InventoryMovementType`.

Thirty-six models: `User`, `Role`, `Permission`, `Session`, `ExpressSession`, `Address`, `Brand`, `Model`, `UserDevice`, `Category`, `RepairService`, `DeviceServiceCompatibility`, `TechnicianProfile`, `TechnicianSkill`, `Booking`, `BookingStatusEvent`, `RepairAssignment`, `Inspection`, `Evidence`, `RepairEstimate`, `RepairEstimateLine`, `RepairEstimateDecision`, `Part`, `PartCompatibility`, `Hub`, `HubInventory`, `InventoryMovement`, `PartRequest`, `PartRequestLine`, `Payment`, `PaymentAttempt`, `Refund`, `AuditLog`, `VendorKycApplication`, `VendorIdentityDocument`, `VendorKycReviewLog`.

The auth models now follow Constructor's direct `User.roleId` and implicit `Role.permissions` relations, with six account roles and action/resource permissions. OTP state remains in the auth process, not Prisma. The schema also contains KYC and notification models, while service areas/slots, repair-job/QC/warranty, handover/custody, finance/settlement, complaints and accessory models remain absent. Several statuses are free-form strings. `RepairService.basePrice` is nullable, appropriately avoiding invented prices but requiring booking confirmation to reject missing pricing.

## Existing APIs and behavior

The bootstrap defines `/health/live`, `/health/ready` and mounts `/api/v1/auth`, `/api/v1/catalog`, `/api/v1/devices`, `/api/v1/bookings`, plus Swagger UI at `/docs`. Only health handlers and auth routes are currently backed by source files. Auth route source declares legacy OTP login/signup, password, OAuth and logout paths; bootstrap and tests expect a different API (`register`, `login`, `refresh`, `otp/request`, `me`, sessions). Because imports and controllers are not coherent, these are route declarations, not verified working endpoints. Catalog/device/booking APIs cannot be confirmed from source.

Potentially useful existing foundations include relational constraints and decimal money fields, booking status history, estimate version uniqueness and decisions, inventory movement records, refresh-session/OTP schema, request IDs, safe error middleware, rate-limiting/security middleware, environment validation code, and OpenAPI setup. Their end-to-end behavior must be revalidated after source restoration/stabilization.

## Validation results actually run

Commands were run locally; no production data was accessed:

- `npm run build` — **failed**. `prisma generate` succeeded, then TypeScript failed due to missing router modules, a missing rate-limit export, missing legacy imports (`middlewares/auth.middleware`, config/database, utils/errors, order service, bcrypt), missing Express request properties, and strict optional-property errors.
- `npm test -- --runInBand` — **failed before tests executed**. Jest could not stat `src/modules/devices/device.routes.ts`, which is missing in this checkout.
- `npm run lint` — **failed**, 85 lint errors in auth/OAuth files, primarily explicit `any`, unused symbols and `@ts-ignore`.
- `npx prisma validate` — **failed before schema evaluation** because `DATABASE_URL` was not set. No connection was attempted. A later validation may use a harmless placeholder URL.
- No DB migration, integration test, deploy, or destructive command was run.

## Requirements implementation snapshot

Implemented or represented in current schema/source: basic user/role/permission tables, session and OTP data, user/device/catalog schema, simple bookings/assignments, inspection/evidence, estimate versions/decisions, basic parts/hubs/movement ledger, payment attempts/refunds and audit data. Current executable completeness is unverified due to broken imports.

Missing or materially incomplete: source-coherent authentication/session workflow; permission checks and resource ownership across endpoints; vendor KYC and approval; booking slots/matching/assignment concurrency; arrival verification; private-media upload verification; repair state machine and required prerequisite guards; payment provider signature/webhook/idempotency; stock reservation/issue/return/DOA correctness; repair execution, QC and warranty; service-centre escalation and custody; finance/commission/settlement; support/complaints, notifications, reporting, loss-demand tracking; complete API docs/Postman; operational backup/restore/release guidance.

## Preservation and next action

Preserve the existing Prisma models, initial migration, tests, and documentation until references, data impact, and migration consequences have been analyzed. Do not apply the migration or connect to a database during this audit. The safe next implementation step is to establish the intended source baseline and repair only the foundation within the current Express/Prisma architecture, then rerun build/test/lint/schema validation. Do not begin domain feature implementation until Phase 1 has a coherent, verifiable baseline.

See [requirements-to-code mapping](REQUIREMENTS_MATRIX.md), [architecture](ARCHITECTURE.md), [role and permission matrix](ROLE_PERMISSION_MATRIX.md), [workflow state machines](WORKFLOW_STATE_MACHINES.md), [open decisions](OPEN_DECISIONS.md), and [roadmap](IMPLEMENTATION_ROADMAP.md).
