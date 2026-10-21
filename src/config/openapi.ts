import swaggerJsdoc from "swagger-jsdoc";

const openapi = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "HUKMEE API",
      version: "1.0.0",
      description:
        "Mobile repair platform API. Policy-dependent workflows are documented as pending until approved.",
    },
    servers: [{ url: "/api" }, { url: "/api/v1" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        sessionTokenCookie: {
          type: "apiKey",
          in: "cookie",
          name: "session_token",
        },
        expressSessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "connect.sid",
        },
      },
      schemas: {
        Identifier: {
          type: "string",
          minLength: 7,
          maxLength: 254,
          description:
            "Valid email address or phone number (+ optional, 7–24 digits).",
        },
        RegisterRequest: {
          type: "object",
          required: ["displayName", "password"],
          properties: {
            displayName: { type: "string", minLength: 1, maxLength: 120 },
            email: { type: "string", format: "email" },
            phone: { type: "string", minLength: 7, maxLength: 24 },
            password: { type: "string", minLength: 12, maxLength: 128 },
            role: {
              type: "string",
              enum: [
                "USER",
                "WORKER",
                "TECHNICIAN",
                "VENDOR",
                "DELIVERY_PARTNER",
              ],
              default: "USER",
            },
          },
          description: "At least one of email or phone is required.",
        },
        LoginRequest: {
          type: "object",
          required: ["identifier"],
          properties: {
            identifier: { $ref: "#/components/schemas/Identifier" },
          },
        },
        PasswordLoginRequest: {
          type: "object",
          required: ["identifier", "password"],
          properties: {
            identifier: { $ref: "#/components/schemas/Identifier" },
            password: { type: "string", minLength: 1, maxLength: 128 },
          },
        },
        AdminLoginRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 1, maxLength: 128 },
          },
        },
        OtpLoginRequest: {
          type: "object",
          required: ["identifier", "otp"],
          properties: {
            identifier: { $ref: "#/components/schemas/Identifier" },
            otp: { type: "string", pattern: "^\\d{6}$" },
          },
        },
        RefreshRequest: {
          type: "object",
          properties: {
            refreshToken: {
              type: "string",
              minLength: 40,
              maxLength: 256,
              description:
                "Optional for clients that send the HttpOnly session_token cookie.",
            },
          },
        },
        OtpRequest: {
          type: "object",
          required: ["identifier"],
          properties: {
            identifier: { $ref: "#/components/schemas/Identifier" },
          },
        },
        OtpVerifyRequest: {
          type: "object",
          required: ["identifier", "code"],
          properties: {
            identifier: { $ref: "#/components/schemas/Identifier" },
            code: { type: "string", pattern: "^\\d{6}$" },
          },
        },
        PasswordResetRequest: {
          type: "object",
          required: ["identifier", "code", "newPassword"],
          properties: {
            identifier: { $ref: "#/components/schemas/Identifier" },
            code: { type: "string", pattern: "^\\d{6}$" },
            newPassword: { type: "string", minLength: 12, maxLength: 128 },
          },
        },
        UpdateProfileRequest: {
          type: "object",
          properties: {
            firstName: { type: "string", minLength: 1, maxLength: 80 },
            lastName: { type: "string", minLength: 1, maxLength: 80 },
            displayName: { type: "string", minLength: 1, maxLength: 120 },
            email: { type: "string", format: "email" },
            phone: {
              type: "string",
              minLength: 7,
              maxLength: 24,
              readOnly: true,
            },
            profileImage: { type: "string", format: "uri" },
          },
          description:
            "Email can be added or updated. Phone is read-only and must match the signed-in account. PUT /users/profile also accepts multipart/form-data with profileImage (JPEG, PNG, or WebP; max 5 MB).",
        },
        VendorKycDocumentReviewRequest: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              type: "string",
              enum: ["APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"],
            },
            feedback: { type: "string", maxLength: 2000 },
          },
        },
        VendorKycApplicationReviewRequest: {
          $ref: "#/components/schemas/VendorKycDocumentReviewRequest",
        },
        AddressCreateRequest: {
          oneOf: [
            {
              type: "object",
              required: [
                "name",
                "phone",
                "type",
                "addressLine1",
                "city",
                "state",
                "country",
                "pincode",
              ],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                phone: { type: "string", minLength: 7, maxLength: 24 },
                type: { type: "string", enum: ["HOME", "WORK", "OTHER"] },
                addressLine1: { type: "string", minLength: 1, maxLength: 200 },
                addressLine2: { type: "string", maxLength: 200 },
                city: { type: "string", minLength: 1, maxLength: 100 },
                state: { type: "string", minLength: 1, maxLength: 100 },
                country: { type: "string", minLength: 1, maxLength: 100 },
                pincode: { type: "string", minLength: 1, maxLength: 20 },
                latitude: { type: "number", minimum: -90, maximum: 90 },
                longitude: { type: "number", minimum: -180, maximum: 180 },
                isDefault: { type: "boolean", default: false },
              },
            },
            {
              type: "object",
              required: ["line1", "city", "postalCode", "countryCode"],
              properties: {
                label: { type: "string", maxLength: 60 },
                line1: { type: "string", minLength: 1, maxLength: 200 },
                line2: { type: "string", maxLength: 200 },
                city: { type: "string", minLength: 1, maxLength: 100 },
                region: { type: "string", maxLength: 100 },
                postalCode: { type: "string", minLength: 1, maxLength: 20 },
                countryCode: { type: "string", minLength: 2, maxLength: 2 },
              },
            },
          ],
        },
        AddressUpdateRequest: {
          type: "object",
          minProperties: 1,
          description: "Any non-empty subset of address fields.",
          properties: {
            label: { type: "string", maxLength: 60 },
            line1: { type: "string", minLength: 1, maxLength: 200 },
            line2: { type: "string", maxLength: 200 },
            city: { type: "string", minLength: 1, maxLength: 100 },
            region: { type: "string", maxLength: 100 },
            postalCode: { type: "string", minLength: 1, maxLength: 20 },
            countryCode: { type: "string", minLength: 2, maxLength: 2 },
          },
        },
        DeviceCreateRequest: {
          type: "object",
          required: ["modelId"],
          properties: {
            modelId: { type: "string", format: "uuid" },
            nickname: { type: "string", minLength: 1, maxLength: 80 },
            serialNumber: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
        BookingCreateRequest: {
          type: "object",
          required: ["deviceId", "serviceId", "problemDescription"],
          properties: {
            deviceId: { type: "string", format: "uuid" },
            serviceId: { type: "string", format: "uuid" },
            partGradeId: {
              type: "string",
              format: "uuid",
              description:
                "Optional for backwards compatibility. When supplied, the server validates it and snapshots its configured price; client prices are ignored.",
            },
            addressId: { type: "string", format: "uuid" },
            problemDescription: {
              type: "string",
              minLength: 5,
              maxLength: 2000,
            },
          },
        },
        BookingAssignmentRequest: {
          type: "object",
          required: ["technicianUserId"],
          properties: { technicianUserId: { type: "string", format: "uuid" } },
        },
      },
    },
    paths: {
      "/auth/register": {
        post: {
          summary: "Start registration and send a verification OTP",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegisterRequest" },
              },
            },
          },
          responses: {
            "202": { description: "Registration OTP accepted" },
            "400": { description: "Invalid request" },
            "409": { description: "Account already exists" },
          },
        },
      },
      "/auth/verify-registration": {
        post: {
          summary: "Verify registration OTP and create a session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OtpLoginRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "Registration complete; session cookies set",
            },
            "400": { description: "Invalid or expired OTP" },
          },
        },
      },
      "/auth/login": {
        post: {
          summary: "Request a login OTP (Davai-compatible flow)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginRequest" },
              },
            },
          },
          responses: {
            "202": { description: "Login OTP request accepted" },
            "503": { description: "OTP delivery is not configured" },
          },
        },
      },
      "/auth/password/login": {
        post: {
          summary: "Compatibility password login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PasswordLoginRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Session cookies set" },
            "401": { description: "Invalid credentials" },
          },
        },
      },
      "/auth/admin/login": {
        post: {
          summary: "Admin or Super Admin password login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AdminLoginRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Admin session created" },
            "401": { description: "Invalid credentials" },
            "403": { description: "Admin role required" },
          },
        },
      },
      "/auth/verify-login": {
        post: {
          summary: "Verify login OTP and establish a session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OtpLoginRequest" },
              },
            },
          },
          responses: {
            "200": { description: "OTP verified; session cookies set" },
            "400": { description: "Invalid or expired OTP" },
          },
        },
      },
      "/auth/send-otp": {
        post: {
          summary: "Request OTP login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["identifier"],
                  properties: {
                    identifier: { $ref: "#/components/schemas/Identifier" },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "OTP request accepted" },
            "503": { description: "OTP provider is not configured" },
          },
        },
      },
      "/auth/verify-otp": {
        post: {
          summary: "Verify OTP and establish a login session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OtpLoginRequest" },
              },
            },
          },
          responses: {
            "200": { description: "OTP verified; session created" },
          },
        },
      },
      "/auth/custom/send-otp": {
        post: {
          summary: "Custom OTP login request alias",
          responses: {
            "202": { description: "OTP request accepted" },
            "503": { description: "OTP provider is not configured" },
          },
        },
      },
      "/auth/custom/resend-otp": {
        post: {
          summary: "Custom OTP resend alias",
          responses: {
            "202": { description: "OTP request accepted" },
            "503": { description: "OTP provider is not configured" },
          },
        },
      },
      "/auth/custom/verify-otp": {
        post: {
          summary: "Custom OTP login verification alias",
          responses: {
            "200": { description: "OTP verified; session created" },
            "400": { description: "Invalid or expired OTP" },
          },
        },
      },
      "/auth/refresh": {
        post: {
          summary: "Rotate refresh token or session cookie",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RefreshRequest" },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Rotated tokens and refreshed HttpOnly session_token cookie",
            },
            "401": { description: "Invalid, expired, or reused token" },
          },
        },
      },
      "/auth/otp/request": {
        post: {
          summary: "Request contact verification or password reset OTP",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OtpRequest" },
              },
            },
          },
          responses: {
            "202": { description: "Request accepted" },
            "503": { description: "OTP provider is not configured" },
          },
        },
      },
      "/auth/otp/verify": {
        post: {
          summary: "Verify a contact OTP",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OtpVerifyRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Contact verified" },
            "400": { description: "Invalid or expired OTP" },
          },
        },
      },
      "/auth/password-reset": {
        post: {
          summary: "Reset password and revoke existing sessions",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PasswordResetRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Password reset" },
            "400": { description: "Invalid or expired OTP" },
          },
        },
      },
      "/auth/forgot-password": {
        post: {
          summary: "Request a password reset OTP",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["identifier"],
                  properties: {
                    identifier: { $ref: "#/components/schemas/Identifier" },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Reset request accepted" },
            "503": { description: "OTP provider is not configured" },
          },
        },
      },
      "/auth/reset-password": {
        post: {
          summary: "Reset password with a single-use OTP",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PasswordResetRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Password reset; active sessions revoked" },
            "400": { description: "Invalid or expired OTP" },
          },
        },
      },
      "/auth/me": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Get current account",
          responses: {
            "200": { description: "Current user" },
            "401": { description: "Authentication required" },
          },
        },
      },
      "/auth/logout": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Revoke current session",
          responses: {
            "200": { description: "Logged out successfully" },
            "401": { description: "Authentication required" },
          },
        },
      },
      "/auth/delete-account": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Deactivate the authenticated account",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["password"],
                  properties: { password: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Account deleted and sessions revoked" },
            "401": { description: "Authentication or password required" },
          },
        },
      },
      "/auth/google": {
        get: {
          summary: "Google OAuth (not configured)",
          responses: {
            "503": { description: "OAuth provider is not configured" },
          },
        },
      },
      "/auth/google/callback": {
        get: {
          summary: "Google OAuth callback (not configured)",
          responses: {
            "503": { description: "OAuth provider is not configured" },
          },
        },
      },
      "/auth/facebook": {
        get: {
          summary: "Facebook OAuth (not configured)",
          responses: {
            "503": { description: "OAuth provider is not configured" },
          },
        },
      },
      "/auth/facebook/callback": {
        get: {
          summary: "Facebook OAuth callback (not configured)",
          responses: {
            "503": { description: "OAuth provider is not configured" },
          },
        },
      },
      "/auth/logout-all": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Revoke all active sessions",
          responses: { "200": { description: "Sessions revoked" } },
        },
      },
      "/auth/sessions": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "List own sessions without tokens",
          responses: { "200": { description: "Session metadata" } },
        },
      },
      "/auth/sessions/{sessionId}": {
        delete: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Revoke one of your sessions",
          parameters: [
            {
              in: "path",
              name: "sessionId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "204": { description: "Session revoked" },
            "404": { description: "Session not found" },
          },
        },
      },
      "/catalog/brands": {
        get: {
          summary: "List active device brands",
          responses: { "200": { description: "Active brands" } },
        },
      },
      "/catalog/models": {
        get: {
          summary: "List active device models",
          parameters: [
            {
              in: "query",
              name: "brandId",
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Active models" },
            "400": { description: "Invalid query" },
          },
        },
      },
      "/catalog/categories": {
        get: {
          summary:
            "List active categories, optionally filtered by compatible model",
          parameters: [
            {
              in: "query",
              name: "modelId",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Active compatible service categories" },
            "400": { description: "Invalid query" },
          },
        },
      },
      "/catalog/categories/{categoryId}/services": {
        get: {
          summary: "List services, parts, and priced grades for a category",
          parameters: [
            {
              in: "path",
              name: "categoryId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "query",
              name: "modelId",
              required: false,
              description:
                "Optionally restrict services and parts to one active model and brand",
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Category and its selectable service data" },
            "400": { description: "Invalid categoryId or modelId" },
            "404": { description: "Active category not found" },
          },
        },
      },
      "/catalog/services": {
        get: {
          summary:
            "List active compatible repair services and their applicable priced parts",
          parameters: [
            {
              in: "query",
              name: "modelId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "query",
              name: "categoryId",
              required: false,
              description:
                "When supplied, returns services for this category as a flat list",
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "query",
              name: "serviceId",
              description:
                "Optionally return only this service; requires modelId",
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description:
                "Active compatible services; with modelId, each service includes active mapped compatible parts and their active priced grades",
            },
            "400": { description: "Invalid query" },
          },
        },
      },
      "/catalog/services/{serviceId}/parts": {
        get: {
          summary:
            "List active parts and priced grades for a service and model",
          parameters: [
            {
              in: "path",
              name: "serviceId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "query",
              name: "modelId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Compatible parts and selectable grades" },
            "400": { description: "Invalid serviceId or modelId" },
            "404": { description: "Repair service not found" },
          },
        },
      },
      "/catalog/parts/{partId}/grades": {
        get: {
          summary: "List active priced grades for a part",
          parameters: [
            {
              in: "path",
              name: "partId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "query",
              name: "serviceId",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "query",
              name: "modelId",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Active priced part grades" },
            "400": { description: "Invalid or incompatible mapping" },
            "404": { description: "Part, service, or model not found" },
          },
        },
      },
      "/admin/catalog/parts/{partId}/grades": {
        get: {
          security: [{ bearerAuth: [] }],
          summary: "List grades for a part (ADMIN or SUPER_ADMIN)",
          parameters: [
            {
              in: "path",
              name: "partId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Part grade catalogue records" },
            "404": { description: "Part not found" },
          },
        },
        post: {
          security: [{ bearerAuth: [] }],
          summary: "Create a part grade (ADMIN or SUPER_ADMIN)",
          parameters: [
            {
              in: "path",
              name: "partId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string", maxLength: 100 },
                    price: { type: "number", nullable: true, minimum: 0 },
                    active: { type: "boolean" },
                    image: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Part grade created" },
            "409": { description: "Duplicate grade name for this part" },
          },
        },
      },
      "/admin/catalog/part-grades/{gradeId}": {
        patch: {
          security: [{ bearerAuth: [] }],
          summary: "Update a part grade (ADMIN or SUPER_ADMIN)",
          parameters: [
            {
              in: "path",
              name: "gradeId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", maxLength: 100 },
                    price: { type: "number", nullable: true, minimum: 0 },
                    active: { type: "boolean" },
                    image: { type: "string", format: "binary" },
                    clearImage: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Part grade updated" },
            "404": { description: "Part grade not found" },
            "409": { description: "Duplicate grade name for this part" },
          },
        },
        delete: {
          security: [{ bearerAuth: [] }],
          summary: "Deactivate a part grade (ADMIN or SUPER_ADMIN)",
          parameters: [
            {
              in: "path",
              name: "gradeId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Part grade deactivated" },
            "404": { description: "Part grade not found" },
          },
        },
      },
      "/devices": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "List the authenticated user's devices",
          responses: {
            "200": { description: "Owned devices" },
            "401": { description: "Authentication required" },
          },
        },
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Register a device to the authenticated user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeviceCreateRequest" },
              },
            },
          },
          responses: {
            "201": { description: "Device registered" },
            "400": { description: "Invalid model or request" },
          },
        },
      },
      "/devices/{deviceId}": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Get an owned device",
          parameters: [
            {
              in: "path",
              name: "deviceId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Owned device" },
            "404": { description: "Device not found" },
          },
        },
      },
      "/bookings": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "List the authenticated user's repair requests",
          responses: { "200": { description: "User repair requests" } },
        },
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Create a compatible repair request (USER role required)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BookingCreateRequest" },
              },
            },
          },
          responses: {
            "201": { description: "Repair request created" },
            "400": { description: "Invalid or incompatible request" },
          },
        },
      },
      "/bookings/{bookingId}": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Get an owned repair request and its recorded history",
          parameters: [
            {
              in: "path",
              name: "bookingId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Owned request details" },
            "404": { description: "Booking not found" },
          },
        },
      },
      "/bookings/{bookingId}/assign": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Offer an eligible technician assignment (bookings:manage permission required)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/BookingAssignmentRequest",
                },
              },
            },
          },
          parameters: [
            {
              in: "path",
              name: "bookingId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "201": { description: "Assignment offered" },
            "403": { description: "Permission required" },
            "409": { description: "Booking is no longer assignable" },
          },
        },
      },
      "/bookings/assignments": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "List the authenticated technician's offered and accepted assignments",
          responses: {
            "200": { description: "Technician assignments" },
            "403": { description: "Technician role required" },
          },
        },
      },
      "/bookings/eligible-technicians": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "List active, approved, active-account technicians with an active service skill (bookings:manage required)",
          parameters: [
            {
              in: "query",
              name: "serviceId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Eligible technician user IDs" },
            "400": { description: "Invalid serviceId" },
            "403": { description: "Permission required" },
          },
        },
      },
      "/bookings/{bookingId}/accept": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Accept the authenticated technician's offered assignment",
          parameters: [
            {
              in: "path",
              name: "bookingId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Assignment accepted; booking moves to ACCEPTED",
            },
            "404": { description: "Booking or assignment not found" },
            "409": { description: "Booking or assignment state conflict" },
          },
        },
      },
      "/bookings/{bookingId}/reject": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Reject the authenticated technician's offered assignment",
          parameters: [
            {
              in: "path",
              name: "bookingId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Assignment rejected; booking returns to REQUESTED",
            },
            "404": { description: "Booking or assignment not found" },
            "409": { description: "Booking or assignment state conflict" },
          },
        },
      },
      "/bookings/{bookingId}/inspection": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Record inspection findings for the authenticated active, approved assigned technician",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["findings"],
                  properties: {
                    findings: {
                      type: "string",
                      minLength: 1,
                      maxLength: 10000,
                    },
                    technicianNotes: { type: "string", maxLength: 5000 },
                  },
                },
              },
            },
          },
          parameters: [
            {
              in: "path",
              name: "bookingId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "201": { description: "Inspection recorded" },
            "400": { description: "Invalid inspection input" },
            "404": { description: "Booking or accepted assignment not found" },
            "409": {
              description: "Booking is not accepted or inspection exists",
            },
          },
        },
      },
      "/bookings/{bookingId}/estimates": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Submit an immutable estimate version after inspection; assigned technician only",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["lines"],
                  properties: {
                    lines: {
                      type: "array",
                      minItems: 1,
                      maxItems: 100,
                      items: {
                        type: "object",
                        required: ["description", "quantity", "unitAmount"],
                        properties: {
                          description: {
                            type: "string",
                            minLength: 1,
                            maxLength: 500,
                          },
                          quantity: {
                            type: "string",
                            pattern: "^(?=.*[1-9])\\d{1,8}(\\.\\d{1,2})?$",
                            example: "1.00",
                          },
                          unitAmount: {
                            type: "string",
                            pattern: "^\\d{1,10}(\\.\\d{1,2})?$",
                            example: "1250.00",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          parameters: [
            {
              in: "path",
              name: "bookingId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "201": { description: "Submitted estimate and line items" },
            "400": { description: "Invalid estimate input" },
            "404": { description: "Booking or accepted assignment not found" },
            "409": {
              description: "Inspection required or estimate decision pending",
            },
          },
        },
      },
      "/bookings/{bookingId}/estimates/{estimateId}/decision": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Accept or reject a submitted estimate owned by the authenticated user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["accepted"],
                  properties: {
                    accepted: { type: "boolean" },
                    reason: { type: "string", maxLength: 2000 },
                  },
                },
              },
            },
          },
          parameters: [
            {
              in: "path",
              name: "bookingId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "path",
              name: "estimateId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Estimate decision recorded" },
            "404": {
              description: "Estimate not found for this user and booking",
            },
            "409": { description: "Estimate is no longer awaiting a decision" },
          },
        },
      },
      "/inventory/hubs": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "List active hubs (inventory:manage required)",
          responses: {
            "200": { description: "Active hubs" },
            "403": { description: "Permission required" },
          },
        },
      },
      "/inventory/hubs/{hubId}/stock": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Read current stock for an active hub (inventory:manage required)",
          parameters: [
            {
              in: "path",
              name: "hubId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Current hub stock" },
            "404": { description: "Hub not found" },
          },
        },
      },
      "/inventory/hubs/{hubId}/movements": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Read paginated stock movements for an active hub (inventory:manage required)",
          parameters: [
            {
              in: "path",
              name: "hubId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "query",
              name: "limit",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 50,
              },
            },
            {
              in: "query",
              name: "cursor",
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Hub movements" },
            "400": { description: "Invalid query" },
            "404": { description: "Hub not found" },
          },
        },
      },
      "/addresses": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "List the authenticated user's saved addresses",
          responses: { "200": { description: "Owned addresses" } },
        },
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Create an address for the authenticated USER account",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AddressCreateRequest" },
              },
            },
          },
          responses: {
            "201": { description: "Address created" },
            "400": { description: "Invalid address" },
            "401": { description: "Authentication required" },
            "403": { description: "USER role required" },
          },
        },
      },
      "/users/me": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Get the authenticated user's profile",
          responses: {
            "200": { description: "User profile" },
            "403": { description: "User role required" },
          },
        },
        patch: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Update the authenticated USER profile display name",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateProfileRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Updated user profile" },
            "400": { description: "Invalid profile data" },
            "403": { description: "User role required" },
          },
        },
      },
      "/users/profile": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Get the authenticated account profile",
          responses: { "200": { description: "User profile" } },
        },
        put: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Update account profile and optional profile image",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateProfileRequest" },
              },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    firstName: { type: "string", maxLength: 80 },
                    lastName: { type: "string", maxLength: 80 },
                    displayName: { type: "string" },
                    email: { type: "string", format: "email" },
                    phone: { type: "string", readOnly: true },
                    profileImage: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated user profile" },
            "400": { description: "Invalid profile data or image" },
            "401": { description: "Authentication required" },
          },
        },
      },
      "/users/logout": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Revoke the current session and clear auth cookies",
          responses: { "204": { description: "Logged out" } },
        },
      },
      "/users/account": {
        delete: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Deactivate the account after password confirmation",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["password"],
                  properties: { password: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Account deactivated" },
            "401": { description: "Authentication or password invalid" },
          },
        },
      },
      "/vendor/kyc/policy": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Get configured vendor identity document requirements",
          responses: { "200": { description: "Enabled document policy" } },
        },
      },
      "/vendor/kyc/status": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Get own KYC status, completed steps, missing fields and masked documents",
          responses: { "200": { description: "Own KYC application" } },
        },
      },
      "/vendor/kyc/personal-details": {
        get: {
          summary: "Get vendor KYC personal details",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Personal details" } },
        },
        put: {
          summary: "Save vendor KYC personal details",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Personal details saved" } },
        },
      },
      "/vendor/kyc/address": {
        get: {
          summary: "Get vendor KYC address",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Address details" } },
        },
        put: {
          summary: "Save vendor KYC address",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Address saved" } },
        },
      },
      "/vendor/kyc/identity": {
        get: {
          summary: "Get vendor identity document metadata",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Masked document metadata" } },
        },
        put: {
          summary: "Upload a vendor identity document version",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["documentType"],
                  properties: {
                    documentType: { type: "string" },
                    documentNumber: { type: "string" },
                    nameOnDocument: { type: "string" },
                    frontImage: { type: "string", format: "binary" },
                    backImage: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Document uploaded; number is masked" },
          },
        },
      },
      "/vendor/kyc/professional-details": {
        get: {
          summary: "Get vendor professional details",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Professional details" } },
        },
        put: {
          summary: "Save vendor professional details",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Professional details saved" } },
        },
      },
      "/vendor/kyc/bank-details": {
        get: {
          summary: "Get vendor bank details with masked account number",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Masked bank details" } },
        },
        put: {
          summary: "Save encrypted vendor bank details",
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          responses: { "200": { description: "Bank details saved" } },
        },
      },
      "/vendor/kyc/submit": {
        post: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Submit configured vendor identity documents for review",
          responses: {
            "200": { description: "Application submitted" },
            "400": { description: "Required policy documents are incomplete" },
          },
        },
      },
      "/vendor/kyc/documents/{documentId}/{side}": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Fetch own private encrypted document file",
          parameters: [
            {
              in: "path",
              name: "documentId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              in: "path",
              name: "side",
              required: true,
              schema: { type: "string", enum: ["front", "back"] },
            },
          ],
          responses: {
            "200": { description: "Private document file" },
            "404": { description: "File not found" },
          },
        },
      },
      "/admin/vendor-kyc": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "List vendor KYC applications pending review (Admin)",
          responses: { "200": { description: "Pending KYC applications" } },
        },
      },
      "/admin/vendor-kyc/{applicationId}": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Get masked vendor KYC review detail (Admin)",
          responses: {
            "200": { description: "KYC details and review history" },
          },
        },
        patch: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Approve, reject, or request vendor KYC resubmission",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/VendorKycApplicationReviewRequest",
                },
              },
            },
          },
          responses: {
            "200": { description: "Review recorded" },
            "409": { description: "Application state conflict" },
          },
        },
      },
      "/admin/vendor-kyc/documents/{documentId}/review": {
        patch: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Review a vendor identity document (Admin)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/VendorKycDocumentReviewRequest",
                },
              },
            },
          },
          responses: {
            "200": { description: "Document review recorded" },
            "409": { description: "Document already reviewed" },
          },
        },
      },
      "/technicians/profile": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Get the authenticated TECHNICIAN's own profile and service skills",
          responses: {
            "200": {
              description:
                "Own technician profile; includes active, approvedAt and service skills",
            },
            "401": { description: "Authentication required" },
            "403": { description: "TECHNICIAN role required" },
            "404": { description: "Technician profile not found" },
          },
        },
      },
      "/technicians/onboarding/status": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary:
            "Get persisted approval metadata for the authenticated TECHNICIAN",
          description:
            "The current schema has no onboarding submission, rejection, or resubmission state. This endpoint returns only active and approvedAt; it does not infer a workflow status.",
          responses: {
            "200": {
              description: "Own profile's active and approvedAt fields",
            },
            "401": { description: "Authentication required" },
            "403": { description: "TECHNICIAN role required" },
            "404": { description: "Technician profile not found" },
          },
        },
      },
      "/addresses/{addressId}": {
        get: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Get an owned address",
          parameters: [
            {
              in: "path",
              name: "addressId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Owned address" },
            "401": { description: "Authentication required" },
            "403": { description: "USER role required" },
            "404": { description: "Address not found" },
          },
        },
        patch: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Update an owned address (USER role required)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AddressUpdateRequest" },
              },
            },
          },
          parameters: [
            {
              in: "path",
              name: "addressId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Address updated" },
            "400": { description: "Invalid address update" },
            "401": { description: "Authentication required" },
            "403": { description: "USER role required" },
            "404": { description: "Address not found" },
          },
        },
        delete: {
          security: [
            { bearerAuth: [] },
            { expressSessionCookie: [] },
            { sessionTokenCookie: [] },
          ],
          summary: "Delete an owned address (USER role required)",
          parameters: [
            {
              in: "path",
              name: "addressId",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Address deleted" },
            "401": { description: "Authentication required" },
            "403": { description: "USER role required" },
            "404": { description: "Address not found" },
            "409": { description: "Address is referenced by a booking" },
          },
        },
      },
    },
  } as swaggerJsdoc.Options["definition"],
  apis: [],
});

export default openapi;
