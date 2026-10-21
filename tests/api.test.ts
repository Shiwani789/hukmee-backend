import request from "supertest";
import { app } from "../src/main";

describe("API access boundaries", () => {
  it("serves liveness without database access", async () => {
    const response = await request(app).get("/health/live");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Service is running.");
  });

  it("requires authentication for user device routes", async () => {
    const response = await request(app).get("/api/v1/devices");
    expect(response.status).toBe(401);
  });

  it("requires authentication before assignment administration", async () => {
    const response = await request(app)
      .post("/api/v1/bookings/00000000-0000-4000-8000-000000000001/assign")
      .send({ technicianUserId: "00000000-0000-4000-8000-000000000002" });
    expect(response.status).toBe(401);
  });

  it("requires authentication for the current-user and session routes", async () => {
    expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/sessions")).status).toBe(401);
  });

  it("rejects malformed OTP requests without contacting a provider", async () => {
    const response = await request(app)
      .post("/api/v1/auth/otp/request")
      .send({ identifier: "x" });
    expect(response.status).toBe(400);
  });

  it("does not provide a development OTP when delivery is not configured", async () => {
    const response = await request(app)
      .post("/api/v1/auth/otp/request")
      .send({ identifier: "unknown@example.test" });
    expect(response.status).toBe(503);
    expect(response.body.data?.code).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("123456");
  });

  it("requires a refresh token or an active session cookie", async () => {
    const response = await request(app).post("/api/v1/auth/refresh").send({});
    expect(response.status).toBe(401);
  });

  it("returns the standard client error for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{invalid-json");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
    expect(response.body.error.requestId).toBeTruthy();
  });
});
