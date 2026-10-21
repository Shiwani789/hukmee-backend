type JsonObject = Record<string, unknown>;

function responseMessage(method: string, path: string): string | undefined {
  if (method === "GET" && path === "/health/live") return "Service is running.";
  if (method === "GET" && path === "/health/ready") return "Service is ready.";
  if (method === "POST") {
    if (/\/auth\/login$/.test(path))
      return "If the account is eligible, an OTP has been sent.";
    if (/\/auth\/forgot-password$/.test(path))
      return "If the account is eligible, password reset instructions have been sent.";
    if (/\/auth\/(?:send-otp|custom\/send-otp|otp\/request)$/.test(path))
      return "If the account is eligible, an OTP has been sent.";
    if (/\/auth\/(?:custom\/)?resend-otp$/.test(path))
      return "OTP resent successfully.";
    if (/\/auth\/otp\/verify$/.test(path)) return "OTP verified successfully.";
    if (/\/auth\/verify-registration$/.test(path))
      return "Account verified successfully.";
    if (/\/auth\/register$/.test(path))
      return "Account registration started. Verify your contact details to complete setup.";
    if (/\/auth\/(?:logout|logout-all)$|\/users\/logout$/.test(path))
      return "Logged out successfully.";
    if (/\/auth\/refresh$/.test(path)) return "Session refreshed successfully.";
    if (/\/auth\/(?:password-reset|reset-password)$/.test(path))
      return "Password reset successfully.";
    if (/\/auth\/delete-account$|\/users\/account$/.test(path))
      return "Account deleted successfully.";
    if (
      /\/auth\/(?:password\/login|admin\/login|verify-login|verify-otp|custom\/verify-otp)$/.test(
        path,
      )
    )
      return "Login successful.";
  }

  if (method === "GET" && /\/auth\/me$|\/users\/(?:me|profile)$/.test(path))
    return "Profile fetched successfully.";
  if (method === "GET" && /\/auth\/sessions$/.test(path))
    return "Sessions fetched successfully.";
  if (method === "GET" && /\/vendor\/kyc\/status$/.test(path))
    return "Verification status fetched successfully.";
  if (
    (method === "PUT" || method === "PATCH") &&
    /\/users\/(?:me|profile)$/.test(path)
  )
    return "Profile updated successfully.";
  if (
    method === "GET" &&
    /\/technicians\/(?:profile|onboarding\/status)$/.test(path)
  )
    return "Technician information fetched successfully.";

  const resourceRoutes: Array<[RegExp, string]> = [
    [/\/catalog\/brands(?:\/|$)/, "Brands"],
    [/\/catalog\/models(?:\/|$)/, "Device models"],
    [/\/catalog\/categories(?:\/|$)/, "Service categories"],
    [/\/catalog\/service-categories(?:\/|$)/, "Service categories"],
    [/\/catalog\/parts\/[^/]+\/grades(?:\/|$)/, "Part grades"],
    [/\/catalog\/services\/[^/]+\/parts(?:\/|$)/, "Parts"],
    [/\/catalog\/services(?:\/|$)/, "Repair services"],
    [/\/catalog\/parts(?:\/|$)/, "Parts"],
    [/\/devices(?:\/|$)/, "Devices"],
    [/\/bookings(?:\/|$)/, "Bookings"],
    [/\/addresses(?:\/|$)/, "Addresses"],
    [/\/inventory\/hubs(?:\/|$)/, "Inventory"],
    [/\/technicians(?:\/|$)/, "Technician information"],
    [
      /\/vendor\/kyc(?:\/|$)|\/admin\/vendor-kyc(?:\/|$)/,
      "Vendor verification",
    ],
  ];
  const resource = resourceRoutes.find(([pattern]) => pattern.test(path))?.[1];
  if (!resource) return "Request completed successfully.";

  if (method === "GET") return `${resource} fetched successfully.`;
  if (method === "POST") {
    if (/\/bookings\/[^/]+\/assign$/.test(path))
      return "Booking assignment created successfully.";
    if (/\/bookings\/[^/]+\/accept$/.test(path))
      return "Assignment accepted successfully.";
    if (/\/bookings\/[^/]+\/reject$/.test(path))
      return "Assignment declined successfully.";
    if (/\/bookings\/[^/]+\/inspection$/.test(path))
      return "Inspection submitted successfully.";
    if (/\/bookings\/[^/]+\/estimates$/.test(path))
      return "Estimate submitted successfully.";
    if (/\/bookings\/[^/]+\/estimates\/[^/]+\/decision$/.test(path))
      return "Estimate decision submitted successfully.";
    if (/\/vendor\/kyc\/submit$/.test(path))
      return "Verification application submitted successfully.";
    if (/\/bookings(?:\/|$)/.test(path))
      return "Booking request submitted successfully.";
    return "Record created successfully.";
  }
  if (method === "PUT" || method === "PATCH") {
    if (/\/vendor\/kyc\/.*review$/.test(path))
      return "Verification review saved successfully.";
    if (/\/vendor\/kyc(?:\/|$)/.test(path))
      return "Verification details updated successfully.";
    return "Record updated successfully.";
  }
  if (method === "DELETE") {
    if (
      /\/catalog\/(?:brands|models|service-categories|services|parts)\//.test(
        path,
      )
    )
      return "Record deactivated successfully.";
    return "Record deleted successfully.";
  }
  return "Request completed successfully.";
}

/** Add consistent success metadata while preserving existing response fields. */
export function standardizeSuccessPayload(
  body: unknown,
  method: string,
  path: string,
): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const payload = body as JsonObject;
  if ("error" in payload || payload.success === false) return body;
  const normalized: JsonObject = {
    success: typeof payload.success === "boolean" ? payload.success : true,
  };
  const message =
    typeof payload.message === "string"
      ? payload.message
      : responseMessage(method.toUpperCase(), path);
  if (message !== undefined) normalized.message = message;
  for (const [key, value] of Object.entries(payload)) {
    if (key !== "success" && key !== "message" && key !== "data")
      normalized[key] = value;
  }
  if (Object.hasOwn(payload, "data")) normalized.data = payload.data;
  return normalized;
}
