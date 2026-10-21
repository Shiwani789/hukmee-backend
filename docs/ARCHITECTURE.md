# HUKMEE backend architecture

## Current executable architecture

HUKMEE is a strict TypeScript modular monolith using Node.js 22, Express 5, Prisma 6, PostgreSQL, Zod, Pino, Redis, Jest and Supertest. The Prisma schema is the source of role and data model truth. The database role `WORKER` is exposed to authorization checks as both `WORKER` and `TECHNICIAN`; it is not renamed in the database.

`src/app.ts` builds and exports the Express application without starting a listener. `src/main.ts` waits for Redis, starts the listener, and handles graceful shutdown. The app middleware order is request ID, response standardization, request logging, security/CORS, parsing, sessions, global rate limit, health/docs/routes, static uploads, not-found, then centralized error handling.

## Module layout and current status

| Module                                                      | Current organization                                                                                                                      | Status / notes                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`                                                      | routes, controllers, services, OTP/OAuth services, `*.schemas.ts`                                                                         | Active; request schemas on auth endpoints, including OAuth callbacks. Preserves session, cookie and Bearer strategies.                                                                  |
| `user`                                                      | routes, controller, service, `user.schemas.ts`                                                                                            | Active; profile update uses Zod validation.                                                                                                                                             |
| `devices`                                                   | routes, controller, service, `device.schemas.ts`                                                                                          | Active; create and ID inputs validated; list has no input parameters.                                                                                                                   |
| `catalog`                                                   | per-resource folders with route/controller/service/schema entrypoints, role-grouped route trees, shared domain implementation | Active; browse and management entry points share domain operations, preserve existing `/catalog` URLs, and expose an `/admin/catalog` management alias. |
| `bookings`                                                  | role-specific route files, controller, service, `booking.schemas.ts`                                                                      | Active; user, technician and manager routes are separated while preserving the `/bookings` URL space; service owns booking rules.                                                       |
| `address`                                                   | routes, controller, service, `address.schemas.ts`                                                                                         | Active; create/update/ID validation and ownership-scoped service calls.                                                                                                                 |
| `inventory`                                                 | routes, controller, service, `inventory.schemas.ts`                                                                                       | Active; protected by `inventory:manage`, validates hub IDs and movement query.                                                                                                          |
| `technician`                                                | routes, controller, service, `technician.schemas.ts`                                                                                      | Active profile/status endpoints; role-protected.                                                                                                                                        |
| `vendor-kyc`                                                | routes, controllers, services and `vendor-identity.schemas.ts`                                                                            | Active user submission and admin review routes; included in the TypeScript and ESLint baselines.                                                                                        |
| `vendor`                                                    | legacy vendor files                                                                                                                       | Not mounted; still excluded from TypeScript/ESLint until its obsolete model and middleware references are reconciled.                                                                   |
| `banner`, `cms`, `kyc`, `notification`, `payment`, `review` | legacy modules                                                                                                                            | Excluded from TypeScript/ESLint; not mounted by the central router. Do not treat them as production APIs based on their presence alone.                                                 |

The canonical router is `src/routes/index.ts`; it mounts auth, catalog, role-grouped user routes, bookings, inventory, technicians, vendor KYC, and role-grouped admin routes. Booking handlers are further organized by role in `src/modules/bookings/routes`; a feature router composes those role routers without changing their public paths. Active KYC code lives in `src/modules/vendor-kyc` and is included in static checks. The remaining files under `src/modules/vendor` are dormant legacy code.

## Request and authorization flow

```text
HTTP request
  -> request ID, logging and platform middleware
  -> central route mount
  -> authentication (session, session cookie or Bearer JWT)
  -> role and/or permission guard
  -> Zod validation for supplied body, params and query
  -> controller reads validated inputs and authenticated context
  -> service enforces business rules, ownership and transaction needs
  -> Prisma/PostgreSQL
  -> standardized success response or centralized error response
```

Use `validate()` from `src/utils/validate.ts` and the typed accessors from `src/utils/validated-request.ts`. `authenticatedContext()` provides an explicit runtime-checked auth context for controllers. Role and permission guards are separate middleware. `WORKER`/`TECHNICIAN` compatibility is preserved by the auth layer. Keep ownership checks in services and never trust a client-supplied role.

## Route and module inventory

`src/routes/index.ts` is the active route registry. The same router is mounted at `/api/v1` and `/api` for client compatibility. The active groups are:

| Mount               | Feature                                                                                           | Access boundary                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/auth`             | Registration, login, OTP, sessions and account identity                                           | Endpoint-specific; auth throttling applies to the group                            |
| `/catalog`          | Brand, model, service and parts catalogue reads                                                   | Public reads and role/permission-guarded writes as declared by the module          |
| `/admin/catalog`    | Catalog management, including brands, models, service categories, services, parts and part grades | `ADMIN`/`SUPER_ADMIN` route guards                                                 |
| `/devices`          | User-owned devices                                                                                | Authenticated `USER` role and owner scope                                          |
| `/bookings`         | Booking, assignment, inspection and estimate lifecycle                                            | User ownership, technician role, or `bookings:manage` permission per operation     |
| `/inventory`        | Hub, stock and movement reads                                                                     | `inventory:manage` permission                                                      |
| `/addresses`        | Saved addresses                                                                                   | Authenticated owner scope                                                          |
| `/users`            | Current user profile                                                                              | Authenticated user scope                                                           |
| `/technicians`      | Technician profile and status                                                                     | Technician role and self/admin checks                                              |
| `/vendor/kyc`       | Vendor/technician KYC submission and private documents                                            | Vendor or technician role; files are served through an authorized private endpoint |
| `/admin/vendor-kyc` | KYC review                                                                                        | Admin role/permission guards                                                       |

The canonical path prefix is `/api/v1`; `/api` exposes the same handlers for compatibility. Health routes are `/health/live` and `/health/ready`, and OpenAPI UI is `/docs`.

Modules under `src/modules` are not automatically APIs. `banner`, `cms`, `kyc`, `notification`, `payment`, and `review` are legacy, unmounted sources excluded from the TypeScript and ESLint baselines. Do not add dependencies or copy Constructo-only features such as Socket.IO, BullMQ, Passport, or payment providers without a confirmed HUKMEE workflow and configuration. Keep this inventory synchronized when changing `src/routes/index.ts` or a module's route guards.

Use Zod as the request boundary. Keep the established `*.schemas.ts` suffix; only add DTO files when they create a useful public or repeated contract. Controllers should not query Prisma or duplicate domain rules. The existing project does not require a repository layer where services already own the module's Prisma operations cleanly.

## Response and error behavior

Successful responses are standardized by `standardizeApiResponse` while retaining existing `data` fields. Errors use the shared error response utility and centralized middleware, preserve status/code/message/validation details/request ID, and retain the historical nested `error` object for compatibility. Do not expose stack traces, credentials, tokens or raw database diagnostics in HTTP responses. Rate limits use the shared response helper.

## Checks and scope limits

Use `npm run build`, `npm run lint`, `npx prettier --check src tests`, `npx prisma validate`, and `npm test -- --runInBand`. `npm run format:check` invokes `prisma format`; avoid it when a read-only formatting check is required. The existing Supertest suite binds a local listener, so restricted environments may need permitted loopback/network access.

The Prisma schema and migrations are protected: do not edit or generate migrations as part of architecture work without explicit approval. Do not change routes, request DTOs, successful response payloads, role enums, token/session behavior or booking/catalogue business rules as a side effect of standardization.

## Remaining standardization work

- The dormant `src/modules/vendor` implementation remains outside strict TypeScript/ESLint checking because it references obsolete models and middleware.
- Legacy modules still contain imports of a missing `middlewares/auth.middleware`; they are excluded and not mounted, and should be repaired or removed only in a separately reviewed legacy cleanup.
- No global claim of complete architecture standardization is made until legacy modules and their status are addressed with compatibility and scope reviewed.
