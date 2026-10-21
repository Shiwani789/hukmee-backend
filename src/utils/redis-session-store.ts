import session from "express-session";
import { redis } from "../config/redis";

const defaultTtlSeconds = 30 * 24 * 60 * 60;
const prefix = "hukmee:sess:";

export class RedisSessionStore extends session.Store {
  get(
    sid: string,
    callback: (error: unknown, value?: session.SessionData | null) => void,
  ): void {
    void redis
      .get(`${prefix}${sid}`)
      .then((value) => callback(null, value ? JSON.parse(value) : null))
      .catch(callback);
  }

  set(
    sid: string,
    value: session.SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + (value.cookie.maxAge ?? defaultTtlSeconds * 1000);
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    void redis
      .set(`${prefix}${sid}`, JSON.stringify(value), "EX", ttlSeconds)
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    void redis
      .del(`${prefix}${sid}`)
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override touch(
    sid: string,
    value: session.SessionData,
    callback?: () => void,
  ): void {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + (value.cookie.maxAge ?? defaultTtlSeconds * 1000);
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    void redis
      .expire(`${prefix}${sid}`, ttlSeconds)
      .then(() => callback?.())
      .catch(() => callback?.());
  }
}
