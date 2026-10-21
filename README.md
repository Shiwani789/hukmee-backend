# HUKMEE backend

Independent Node.js 22 / TypeScript API for HUKMEE. The current audit and implementation status are documented in [the requirements matrix](docs/REQUIREMENTS_MATRIX.md), [architecture](docs/ARCHITECTURE.md), [workflow proposal](docs/WORKFLOW_STATE_MACHINES.md), [open decisions](docs/OPEN_DECISIONS.md), and [implementation roadmap](docs/IMPLEMENTATION_ROADMAP.md).

## Local setup (Node.js)

1. Install Node.js 22.18+ and PostgreSQL 14+.
2. Create a dedicated local database and role, for example:

   ```sql
   CREATE ROLE hukmee_app LOGIN PASSWORD 'change_me';
   CREATE DATABASE hukmee OWNER hukmee_app;
   ```

3. Copy `.env.example` to `.env`, set newly generated `JWT_ACCESS_SECRET` and `SESSION_SECRET` values and local-only database credentials. OTP remains disabled until an approved provider and policy are configured; see [authentication.md](docs/authentication.md).
   Start Redis locally (for example, `docker compose up -d redis`) and set `REDIS_URL=redis://localhost:6379`; API sessions, rate-limit counters, and public catalogue GET-response cache use Redis. Cache entries expire after `CACHE_TTL_SECONDS` (default 300) and catalogue edits invalidate related entries.
4. Install exact locked dependencies: `npm ci`.
5. Generate Prisma Client and apply the committed initial migration only to this new HUKMEE database:

   ```sh
   npm run db:generate
   npm run db:migrate
   NODE_ENV=development npm run db:seed
   ```

   The seed creates all roles, HUKMEE permissions for admins, and a local super admin (`admin@hukmee.local` / `Hukmee@Admin123`) directly from `prisma/seed.ts`. Optional local accounts can be configured with `SEED_ADMIN_*`, `SEED_VENDOR_*`, `SEED_TECHNICIAN_*`, and `SEED_DELIVERY_PARTNER_*`; set each role's `EMAIL` and `PASSWORD` together. Passwords must be at least 12 characters and are stored as Argon2 hashes. The technician profile and user profile are created for seeded technicians; vendors still complete the regular KYC flow. Seed execution is restricted to development.

6. Run `npm run dev`; open `/docs` for OpenAPI documentation.

The example URL points to a separate database named `hukmee`. No existing database is used by this project. Never use example credentials outside local development. This repository has not run its migration against any database.

## Source layout

- `src/main.ts` starts the API and handles graceful shutdown.
- `src/app.ts` composes Express middleware, feature routers, health endpoints and API docs.
- `src/routes/` groups user, admin, vendor and technician route trees; feature modules keep their routes, controllers, services and Zod schemas together.
- `src/modules/bookings/routes/` separates user, technician and manager endpoints while preserving the existing `/bookings` paths. `src/modules/vendor-kyc/` contains the active KYC flow and admin review APIs.
- `src/modules/catalog/` keeps catalog HTTP handlers, routes, and Prisma business logic in `catalog.controller.ts`, `catalog.routes.ts`, and `catalog.service.ts`. Shared request schemas remain under `src/validation/`. Public browse endpoints and role-protected management endpoints are registered on one router, mounted under `/catalog` and `/admin/catalog` for compatibility.
- `src/modules/address` contains user-owned address CRUD; `src/config`, `src/middlewares`, `src/utils` and `src/types` contain shared configuration, database access, logging, validation, errors and HTTP middleware. Other legacy feature directories are not necessarily mounted or working APIs; see the roadmap and requirements matrix.
- `prisma/` contains the schema, migrations and seed script.

## Docker setup

1. Install Docker Engine/Desktop with the Compose plugin.
2. Copy `.env.example` to `.env` and replace `JWT_ACCESS_SECRET` and `SESSION_SECRET` with different random values of at least 32 characters, and replace `POSTGRES_PASSWORD` with a strong URL-safe, local-only password (letters, digits, underscore or hyphen). Do not commit `.env`.
3. Start the API and its dedicated PostgreSQL container: `docker compose up --build -d`. The database has a named volume and is not exposed on the host.
4. Apply the committed schema to this Compose database explicitly: `docker compose run --rm migrate npm run db:deploy`.
5. Check `http://localhost:4000/health/ready`; browse API docs at `http://localhost:4000/docs`.
6. Stop the containers with `docker compose down`. `docker compose down -v` also deletes the local database volume and all its data.

The Docker image uses Node.js 22, builds in a separate stage, runs as the unprivileged `node` user, and includes a liveness health check. Compose waits for PostgreSQL health before starting the API. Schema deployment is an explicit command so a container restart never changes database schema implicitly.

## Commands

- `npm run build` — generate Prisma Client and compile TypeScript.
- `npm test` — API boundary and in-memory auth HTTP workflow tests; no database is used.
- `npm run test:integration` — opt-in database-backed auth integration test. It runs only when `TEST_DATABASE_URL` is set to a dedicated database whose name ends in `_test`; that database must already have migrations applied. The test does not create, reset or migrate a database.
- `npm run lint` — lint source and tests.
- `npm run format` / `npm run format:check` — format/check supported source and docs plus Prisma schema formatting.
- `npm run db:migrate` — apply/generate the initial local development migration against the configured dedicated HUKMEE database.
- `npm run db:deploy` — apply committed migrations in a controlled deployment pipeline.

Set `NODE_ENV=production` and provide deployment-managed secrets in production. Do not seed production. Public registration cannot create an administrator. Privileged account provisioning must use a controlled operator process.

## Implemented API surface (current checkout)

- `GET /health/live`, `GET /health/ready`
- `POST /api/v1/auth/register`, `/verify-registration`, `/login` (OTP request), `/verify-login`, `/password/login`, `/refresh`, `/logout`, `/logout-all`
- `POST /api/v1/auth/otp/request`, `/otp/verify`, `/password-reset`
- `GET /api/v1/auth/me`, `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:sessionId`
- `GET /api/v1/catalog/brands`, `/models`, `/services`
- `GET|POST /api/v1/devices`, `GET /api/v1/devices/:deviceId` (authenticated user-owned devices)
- `GET|POST /api/v1/bookings`, `GET /api/v1/bookings/:bookingId` (user-owned repair requests)
- `POST /api/v1/bookings/:bookingId/assign` (requires the `bookings:manage` permission and an active, approved technician with the requested service skill)
- `GET /api/v1/bookings/eligible-technicians?serviceId=<uuid>` (requires `bookings:manage`; returns user IDs with an active account, `TECHNICIAN` role, approved/active profile and active matching service skill)
- `GET /api/v1/bookings/assignments` (technician role; lists own offered and accepted assignments)
- `POST /api/v1/bookings/:bookingId/accept` and `/reject` (technician role; only the assigned technician can decide an offered assignment; rejection returns the booking to `REQUESTED`)
- `POST /api/v1/bookings/:bookingId/inspection` (active, approved assigned technician records inspection findings after acceptance)
- `POST /api/v1/bookings/:bookingId/estimates` (assigned technician submits an immutable version with decimal line items after inspection)
- `POST /api/v1/bookings/:bookingId/estimates/:estimateId/decision` (booking owner accepts or rejects a submitted estimate; decisions are recorded and duplicate decisions conflict)
- `GET /api/v1/inventory/hubs`, `/hubs/:hubId/stock`, `/hubs/:hubId/movements` (all require `inventory:manage`; movement history uses `limit` and `cursor`)
- `GET|PATCH /api/v1/users/me` (authenticated user profile; display name can be updated)
- `GET|POST /api/v1/addresses`, `GET|PATCH|DELETE /api/v1/addresses/:addressId` (user-owned saved addresses)
- Swagger UI at `/docs`

Booking creation records a compatible `REQUESTED` repair request. A permitted manager can offer it to an active, approved technician with the matching service skill; the technician can accept or reject the offer. Acceptance advances the booking to `ACCEPTED`; rejection records the decision and returns the booking to `REQUESTED` for possible reassignment. After acceptance, the technician can record inspection findings and submit versioned estimate lines; only the booking owner can decide a submitted estimate. This does not confirm a slot, arrival/location, estimate tax/currency, payment, or repair start. Evidence uploads are not exposed until private storage validation is configured. OTP returns provider-unavailable until approved provider configuration is supplied; no payment provider or production object storage is configured.

Inventory APIs are currently read-only: they expose active hubs, current stock, and movement history to users with `inventory:manage`. Payment state changes, refunds, stock adjustments, transfers, and part issue/return remain unavailable until provider, finance, hub-scope and inventory approval policies are configured.
