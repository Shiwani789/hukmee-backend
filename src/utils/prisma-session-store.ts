import session from "express-session";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/database";

const defaultLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export class PrismaSessionStore extends session.Store {
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    super();
    this.cleanupTimer = setInterval(
      () => {
        void prisma.expressSession
          .deleteMany({ where: { expire: { lte: new Date() } } })
          .catch(() => undefined);
      },
      60 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  get(
    sid: string,
    callback: (error: unknown, value?: session.SessionData | null) => void,
  ): void {
    void prisma.expressSession
      .findUnique({ where: { sid } })
      .then(async (record) => {
        if (!record || record.expire <= new Date()) {
          if (record)
            await prisma.expressSession.deleteMany({ where: { sid } });
          callback(null, null);
          return;
        }
        callback(null, record.sess as unknown as session.SessionData);
      })
      .catch(callback);
  }

  set(
    sid: string,
    value: session.SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    const expiresAt = this.expiry(value);
    const serialized = JSON.parse(
      JSON.stringify(value),
    ) as Prisma.InputJsonValue;
    void prisma.expressSession
      .upsert({
        where: { sid },
        create: {
          sid,
          sess: serialized,
          expire: expiresAt,
        },
        update: {
          sess: serialized,
          expire: expiresAt,
        },
      })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    void prisma.expressSession
      .deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override touch(
    sid: string,
    value: session.SessionData,
    callback?: () => void,
  ): void {
    void prisma.expressSession
      .updateMany({
        where: { sid },
        data: { expire: this.expiry(value) },
      })
      .then(() => callback?.())
      .catch(() => callback?.());
  }

  private expiry(value: session.SessionData): Date {
    const expiry = value.cookie.expires;
    if (expiry) return new Date(expiry);
    const lifetime = value.cookie.maxAge ?? defaultLifetimeMs;
    return new Date(Date.now() + lifetime);
  }
}
