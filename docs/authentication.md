# Authentication and OTP provider contract

- Registration starts an inactive USER account and requires a REGISTRATION_VERIFICATION OTP before activation and session creation. OTP delivery requires the configured provider.
- OTP verification and registration issue Davai-style `connect.sid` and `session_token` HttpOnly cookies. `connect.sid` is an Express session stored in the Prisma `ExpressSession` model/table (`express_session`), never Express MemoryStore. The row contains the session data and expiry; auth identity also references the existing revocable `Session` record. `session_token` contains the refresh credential whose SHA-256 digest is stored in the existing `Session` row. Both cookies are Secure in production and use SameSite=None in production (Lax in development); browser clients must send credentials on cross-origin requests. The auth middleware accepts Express sessions, the `session_token` cookie, and Authorization Bearer tokens for existing mobile/API clients.
- Refresh tokens are random opaque values prefixed by their session UUID. Rotation replaces the digest atomically and resets the HttpOnly cookie. Reuse of an old token revokes the session and records an audit event. Refresh can use the cookie without a request body or an explicit `{ "refreshToken": "..." }` body for non-browser clients.
- Access JWTs continue to use HS256, short configured expiry, issuer `hukmee-api`, audience `hukmee-clients`, subject user ID and session ID. Middleware checks active database sessions and accounts in PostgreSQL on each protected request, then loads current roles and permissions.
- Passwords use Argon2id. Password reset consumes the active OTP for the identifier and revokes all active sessions.
- OTP state follows the Constructor auth flow and is held in a process-local store keyed by identifier. It stores an HMAC digest, attempt count, expiry and consumption time; resending replaces the previous OTP. Raw OTP is sent only to the configured provider and never returned or logged. The provider is disabled unless all required provider and policy settings are present. A local static OTP is accepted only when `NODE_ENV=development` and `OTP_DEV_STATIC_CODE` is explicitly configured.
- OTPs are not separated by purpose: requesting a new OTP replaces the previous code for that identifier, and the same active code can be submitted to any OTP verification route. The process-local store also means OTP requests and verification must reach the same running API instance.

## Configured HTTP delivery adapter

Set `OTP_PROVIDER_URL` (HTTPS in production) and `OTP_PROVIDER_TOKEN`; also set the approved `OTP_CHALLENGE_TTL_SECONDS` and `OTP_MAX_ATTEMPTS`. VENDOR and DELIVERY_PARTNER are available as account roles for OTP registration; their onboarding/KYC flows remain separate from authentication. The backend sends an authenticated JSON `POST` with `{ recipient, code, expiresInSeconds }`. A 2xx response means accepted for delivery; any other status is a delivery failure. The endpoint must not echo the code in responses or logs. Configure a provider endpoint that is trusted by the deployment; do not expose it to client input.

If these settings are absent, OTP requests outside development return `503 OTP_PROVIDER_UNAVAILABLE`. In development only, OTP flows use `123456` by default when no provider is configured, matching Davai's local flow; set `OTP_DEV_STATIC_CODE` to override it. This development code cannot be enabled in production. When a provider is configured in development, it takes precedence unless `OTP_DEV_STATIC_CODE` is explicitly set.

## Endpoints

- `POST /api/v1/auth/register` and `/verify-registration` (OTP signup; roles USER, WORKER, VENDOR or DELIVERY_PARTNER; TECHNICIAN is accepted as a compatibility alias for WORKER), `/login` (OTP request), `/password/login` (password compatibility), `/admin/login`, `/verify-login`, `/send-otp`, `/verify-otp`, `/refresh`, `/logout`, `/logout-all`, `/forgot-password`, `/reset-password`, `/delete-account`; registration starts without cookies; successful OTP verification and login set both cookies, refresh rotates them, and logout clears them.
- `/custom/send-otp`, `/custom/resend-otp`, and `/custom/verify-otp` are aliases for the OTP login flow. Roles are USER, WORKER, VENDOR, and DELIVERY_PARTNER (TECHNICIAN is accepted as a WORKER alias); ADMIN OTP login is denied.
- Google and Facebook start/callback paths exist but return `503 OAUTH_NOT_CONFIGURED` until provider credentials, callbacks, and account-linking rules are configured.
- `/delete-account` confirms the current password, deactivates the account and revokes its sessions while retaining records referenced by bookings and audit history. `/reset-password` retains Hukmee's one-time OTP requirement; it does not accept an unauthenticated password-only reset.
- `POST /api/v1/auth/otp/request` with `{ "identifier": "email-or-phone" }`
- `POST /api/v1/auth/otp/verify` with identifier and six-digit code
- `POST /api/v1/auth/password-reset` with identifier, code and new password
- `GET /api/v1/auth/me`, `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:sessionId`

The provider payload is a generic adapter contract, not a claim that a provider has been selected or configured.

User account routes also include `GET /api/v1/users/profile`, `PUT /api/v1/users/profile` (optional multipart `profileImage`), `POST /api/v1/users/logout`, and `DELETE /api/v1/users/account` (password confirmation). The `/users/profile` routes use the authenticated session for any registered role. Images accept JPEG, PNG, or WebP up to 5 MB and are served from `/uploads/profiles/`.
