import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

type FakeUser = {
  id: string;
  email: string | null;
  phone: string | null;
  password: string | null;
  roleId: string;
  role: { name: string; permissions: { key: string }[] };
  isActive: boolean;
  isDeleted: boolean;
  status: string;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};
type FakeSession = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};
type Args = {
  data?: Record<string, unknown>;
  where?: Record<string, unknown>;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const sessions = new Map<string, FakeSession>();
  const expressSessions = new Map<
    string,
    { sid: string; sess: Record<string, unknown>; expire: Date }
  >();
  const roles = new Map<string, { id: string; name: string }>();
  const audits: unknown[] = [];
  const userDelegate = {
    create: async ({ data }: Args) => {
      const roleConnect = data?.role as { connect: { id: string } };
      const role = [...roles.values()].find(
        (item) => item.id === roleConnect.connect.id,
      );
      const created: FakeUser = {
        id: randomUUID(),
        email: (data?.email as string | undefined) ?? null,
        phone: (data?.phone as string | undefined) ?? null,
        password: (data?.password as string | undefined) ?? null,
        roleId: role?.id ?? "",
        role: { name: role?.name ?? "USER", permissions: [] },
        isActive: true,
        isDeleted: false,
        status: "ACTIVE",
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        lastLoginAt: null,
        createdAt: new Date(),
      };
      users.set(created.id, created);
      return structuredClone(created);
    },
    findFirst: async ({ where }: Args) => {
      const clauses = (where?.OR ?? []) as { email?: string; phone?: string }[];
      const isActive = where?.isActive as boolean | undefined;
      const found = [...users.values()].find(
        (user) =>
          (!isActive || user.isActive) &&
          ((where?.email && user.email === where.email) ||
            (where?.phone && user.phone === where.phone) ||
            clauses.some(
              (clause) =>
                (clause.email && user.email === clause.email) ||
                (clause.phone && user.phone === clause.phone),
            )),
      );
      return found ? structuredClone(found) : null;
    },
    findUnique: async ({ where }: Args) => {
      const user = users.get(where?.id as string);
      return user ? structuredClone(user) : null;
    },
    update: async ({ where, data }: Args) => {
      const user = users.get(where?.id as string);
      if (!user) throw new Error("user missing");
      Object.assign(user, data);
      return structuredClone(user);
    },
  };
  const sessionDelegate = {
    create: async ({ data }: Args) => {
      const session = {
        ...(data as Omit<FakeSession, "createdAt" | "revokedAt">),
        createdAt: new Date(),
        revokedAt: null,
      };
      sessions.set(session.id, session);
      return structuredClone(session);
    },
    findFirst: async ({ where }: Args) => {
      const session = where?.refreshTokenHash
        ? [...sessions.values()].find(
            (item) => item.refreshTokenHash === where.refreshTokenHash,
          )
        : sessions.get(where?.id as string);
      if (
        !session ||
        (where?.userId && session.userId !== where.userId) ||
        session.revokedAt ||
        session.expiresAt <= new Date()
      )
        return null;
      const user = users.get(session.userId);
      return user?.isActive
        ? { ...structuredClone(session), user: structuredClone(user) }
        : null;
    },
    findUnique: async ({ where }: Args) => {
      const session = sessions.get(where?.id as string);
      const user = session ? users.get(session.userId) : undefined;
      return session && user
        ? { ...structuredClone(session), user: structuredClone(user) }
        : null;
    },
    updateMany: async ({ where, data }: Args) => {
      const targets = [...sessions.values()].filter(
        (session) =>
          (!where?.id || session.id === where.id) &&
          (!where?.userId || session.userId === where.userId) &&
          (where?.revokedAt !== null || session.revokedAt === null) &&
          (!where?.refreshTokenHash ||
            session.refreshTokenHash === where.refreshTokenHash),
      );
      for (const session of targets) Object.assign(session, data);
      return { count: targets.length };
    },
    findMany: async ({ where }: Args) =>
      [...sessions.values()]
        .filter((session) => session.userId === where?.userId)
        .map((session) => ({
          id: session.id,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          revokedAt: session.revokedAt,
        })),
  };
  const roleDelegate = {
    upsert: async ({ where, create }: Args) => {
      const name = (where?.name ?? create?.name) as string;
      let role = [...roles.values()].find((item) => item.name === name);
      if (!role) {
        role = { id: randomUUID(), name };
        roles.set(role.id, role);
      }
      return structuredClone(role);
    },
  };
  const auditDelegate = {
    create: async ({ data }: Args) => {
      audits.push(data);
      return data;
    },
  };
  const expressSessionDelegate = {
    findUnique: async ({ where }: Args) => {
      const record = expressSessions.get(where?.sid as string);
      return record ? structuredClone(record) : null;
    },
    upsert: async ({ where, create, update }: Args) => {
      const current = expressSessions.get(where?.sid as string);
      const record = {
        ...((current ? update : create) as {
          sid: string;
          sess: Record<string, unknown>;
          expire: Date;
        }),
      };
      expressSessions.set(record.sid, record);
      return structuredClone(record);
    },
    deleteMany: async ({ where }: Args) => {
      const sid = where?.sid as string | undefined;
      if (sid) return { count: Number(expressSessions.delete(sid)) };
      const cutoff = (where?.expire as { lte?: Date } | undefined)?.lte;
      let count = 0;
      if (cutoff)
        for (const [key, record] of expressSessions)
          if (record.expire <= cutoff) {
            expressSessions.delete(key);
            count += 1;
          }
      return { count };
    },
    updateMany: async ({ where, data }: Args) => {
      const record = expressSessions.get(where?.sid as string);
      if (!record) return { count: 0 };
      Object.assign(record, data);
      return { count: 1 };
    },
  };
  const fake = {
    user: userDelegate,
    role: roleDelegate,
    session: sessionDelegate,
    auditLog: auditDelegate,
    expressSession: expressSessionDelegate,
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) =>
      callback(fake),
  };
  return { fake, users, sessions, audits };
}

describe("authentication HTTP workflow with an isolated persistence fake", () => {
  let app: typeof import("../src/main").app;
  let state: ReturnType<typeof createFakePrisma>;

  beforeAll(async () => {
    state = createFakePrisma();
    jest.doMock("../src/config/database", () => ({
      prisma: state.fake as unknown as PrismaClient,
    }));
    ({ app } = await import("../src/main"));
  });

  it("registers, logs in, rotates/revokes refresh tokens, and masks session data", async () => {
    const email = `auth-${randomUUID()}@example.test`;
    const password = "Correct-Horse-Battery-9!";
    const registrationStart = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/register")
      .send({ email, password, displayName: "Auth Test" });
    expect(registrationStart.status).toBe(202);
    expect(state.users.size).toBe(0);
    const rejectedRegistration = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/verify-registration")
      .send({ identifier: email, otp: "000000" });
    expect(rejectedRegistration.status).toBe(400);
    expect(state.users.size).toBe(0);
    const registration = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/verify-registration")
      .send({ identifier: email, otp: "123456" });
    expect(registration.status).toBe(201);
    expect(registration.body.data.user.password).toBeUndefined();
    expect(registration.body.data.user.roles).toEqual(["USER"]);
    expect(registration.headers["cache-control"]).toBe("no-store");
    expect(registration.body.data.refreshToken).toBeTruthy();
    const firstRefresh = registration.body.data.refreshToken as string;
    const firstAccess = registration.body.data.accessToken as string;
    const userId = registration.body.data.user.id as string;

    const duplicateRegistration = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/register")
      .send({ email, password, displayName: "Auth Test" });
    expect(duplicateRegistration.status).toBe(409);
    expect(state.users.size).toBe(1);

    const otherEmail = `other-${randomUUID()}@example.test`;
    const otherStart = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/register")
      .send({
        email: otherEmail,
        password,
        displayName: "Another User",
      });
    expect(otherStart.status).toBe(202);
    const other = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/verify-registration")
      .send({
        identifier: otherEmail,
        otp: "123456",
      });
    expect(other.status).toBe(201);
    expect(other.status).toBe(201);
    const otherSessionId = (
      await (await import("supertest"))
        .default(app)
        .get("/api/v1/auth/sessions")
        .set("Authorization", `Bearer ${other.body.data.accessToken}`)
    ).body.data[0].id as string;
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .delete(`/api/v1/auth/sessions/${otherSessionId}`)
          .set("Authorization", `Bearer ${firstAccess}`)
      ).status,
    ).toBe(404);

    const login = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/password/login")
      .send({ identifier: email, password });
    expect(login.status).toBe(200);
    const loginSetCookie = login.headers["set-cookie"];
    const loginCookies = Array.isArray(loginSetCookie)
      ? loginSetCookie
      : [loginSetCookie ?? ""];
    const loginCookie =
      loginCookies.find((value) => value.startsWith("session_token=")) ?? "";
    const connectCookie =
      loginCookies.find((value) => value.startsWith("connect.sid=")) ?? "";
    expect(loginCookie).toContain("session_token=");
    expect(connectCookie).toContain("connect.sid=");
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .get("/api/v1/auth/me")
          .set("Cookie", connectCookie.split(";")[0])
      ).status,
    ).toBe(200);
    const cookieRefresh = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loginCookie);
    expect(cookieRefresh.status).toBe(200);
    const rotatedSetCookie = cookieRefresh.headers["set-cookie"];
    const rotatedCookie =
      (Array.isArray(rotatedSetCookie)
        ? rotatedSetCookie[0]
        : rotatedSetCookie
      )?.split(";")[0] ?? "";
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .get("/api/v1/auth/me")
          .set("Cookie", rotatedCookie)
      ).status,
    ).toBe(200);
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .get("/api/v1/auth/me")
          .set("Cookie", loginCookie)
      ).status,
    ).toBe(401);
    expect(
      (
        await (
          await import("supertest")
        )
          .default(app)
          .post("/api/v1/auth/password/login")
          .send({
            identifier: `missing-${randomUUID()}@example.test`,
            password,
          })
      ).status,
    ).toBe(401);
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .get("/api/v1/auth/me")
          .set("Authorization", `Bearer ${firstAccess}`)
      ).status,
    ).toBe(200);

    const rotated = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefresh });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(firstRefresh);
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .get("/api/v1/auth/sessions")
          .set("Authorization", `Bearer ${firstAccess}`)
      ).body.data[0].refreshToken,
    ).toBeUndefined();

    const reuse = await (await import("supertest"))
      .default(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefresh });
    expect(reuse.status).toBe(401);
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .get("/api/v1/auth/me")
          .set("Authorization", `Bearer ${firstAccess}`)
      ).status,
    ).toBe(401);

    const loginToken = login.body.data.accessToken as string;
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .post("/api/v1/auth/logout-all")
          .set("Authorization", `Bearer ${loginToken}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await (await import("supertest"))
          .default(app)
          .get("/api/v1/auth/me")
          .set("Authorization", `Bearer ${loginToken}`)
      ).status,
    ).toBe(401);
    expect(state.users.get(userId)?.password).not.toBe(password);
    expect(state.audits.length).toBeGreaterThanOrEqual(4);
  });
});
