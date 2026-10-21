import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { redis } from "../config/redis";

const cachePrefix = process.env.CACHE_PREFIX?.trim() || "hukmee";

export function buildCacheKey(
  req: Request,
  namespace: string,
  varyByUser = false,
): string {
  const userId = varyByUser
    ? ((req as Request & { auth?: { userId?: string } }).auth?.userId ??
      "anonymous")
    : "shared";
  const hash = createHash("sha256")
    .update(`${req.method}:${req.originalUrl}:${userId}`)
    .digest("hex");
  return `${cachePrefix}:cache:${namespace}:${hash}`;
}

type CacheOptions = {
  ttlSeconds?: number;
  namespace: string;
  varyByUser?: boolean;
};

export const cacheResponse =
  ({
    ttlSeconds = env.CACHE_TTL_SECONDS,
    namespace,
    varyByUser = false,
  }: CacheOptions): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (
      !env.CACHE_ENABLED ||
      env.NODE_ENV === "test" ||
      req.method !== "GET" ||
      req.headers.authorization ||
      redis.status !== "ready"
    ) {
      next();
      return;
    }

    const key = buildCacheKey(req, namespace, varyByUser);
    try {
      const cached = await redis.get(key);
      if (cached) {
        const payload = JSON.parse(cached) as {
          statusCode: number;
          body: unknown;
        };
        res.setHeader("X-Cache", "HIT");
        res.status(payload.statusCode).json(payload.body);
        return;
      }
    } catch (error) {
      logger.warn({ err: error, key }, "Failed to read response cache");
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown): Response => {
      if (
        res.statusCode >= 200 &&
        res.statusCode < 300 &&
        redis.status === "ready"
      ) {
        void redis
          .set(
            key,
            JSON.stringify({ statusCode: res.statusCode, body }),
            "EX",
            ttlSeconds,
          )
          .catch((error: unknown) =>
            logger.warn({ err: error, key }, "Failed to write response cache"),
          );
      }
      res.setHeader("X-Cache", "MISS");
      return originalJson(body);
    }) as Response["json"];
    next();
  };

export const invalidateCacheNamespace = async (
  namespace: string,
): Promise<void> => {
  if (!env.CACHE_ENABLED || redis.status !== "ready") return;
  const pattern = `${cachePrefix}:cache:${namespace}:*`;
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== "0");
};

export const invalidateCache =
  (...namespaces: string[]) =>
  (_req: Request, res: Response, next: NextFunction): void => {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void Promise.all(namespaces.map(invalidateCacheNamespace)).catch(
          (error: unknown) =>
            logger.warn(
              { err: error, namespaces },
              "Failed to invalidate cache",
            ),
        );
      }
    });
    next();
  };
