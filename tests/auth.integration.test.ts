import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../src/main";
import { prisma } from "../src/config/database";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl
  ? new URL(testDatabaseUrl).pathname.slice(1)
  : "";
const canRun = Boolean(testDatabaseUrl && databaseName.endsWith("_test"));

(canRun ? describe : describe.skip)(
  "authentication against a dedicated *_test database",
  () => {
    const email = `phase1-${randomUUID()}@example.test`;
    let userId: string | undefined;

    beforeAll(async () => {
      if (!canRun) return;
      await prisma.role.upsert({
        where: { name: "USER" },
        update: {},
        create: { name: "USER" },
      });
    });

    afterAll(async () => {
      if (userId) {
        await prisma.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await prisma.user.updateMany({
          where: { id: userId },
          data: { isActive: false },
        });
      }
      await prisma.$disconnect();
    });

    it("registers, authenticates, rotates refresh tokens, and revokes sessions", async () => {
      const registered = await request(app).post("/api/v1/auth/register").send({
        email,
        password: "Correct-Horse-Battery-9!",
        displayName: "Phase One Test",
      });
      expect(registered.status).toBe(201);
      expect(registered.body.data.user.password).toBeUndefined();
      expect(registered.body.data.user.roles).toContain("USER");
      userId = registered.body.data.user.id;

      const accessToken = registered.body.data.accessToken as string;
      const firstRefresh = registered.body.data.refreshToken as string;
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", `Bearer ${accessToken}`)
        ).status,
      ).toBe(200);

      const login = await request(app)
        .post("/api/v1/auth/password/login")
        .send({ identifier: email, password: "Correct-Horse-Battery-9!" });
      expect(login.status).toBe(200);
      expect(
        (
          await request(app)
            .post("/api/v1/auth/password/login")
            .send({ identifier: email, password: "incorrect-password" })
        ).status,
      ).toBe(401);

      const rotated = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: firstRefresh });
      expect(rotated.status).toBe(200);
      expect(rotated.body.data.refreshToken).not.toBe(firstRefresh);

      const sessionResponse = await request(app)
        .get("/api/v1/auth/sessions")
        .set("Authorization", `Bearer ${rotated.body.data.accessToken}`);
      expect(sessionResponse.status).toBe(200);
      expect(
        sessionResponse.body.data.every(
          (session: Record<string, unknown>) => !("refreshToken" in session),
        ),
      ).toBe(true);

      expect(
        (
          await request(app)
            .post("/api/v1/auth/logout-all")
            .set("Authorization", `Bearer ${rotated.body.data.accessToken}`)
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", `Bearer ${rotated.body.data.accessToken}`)
        ).status,
      ).toBe(401);
    });
  },
);
