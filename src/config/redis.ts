import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

const redisUrl = new URL(env.REDIS_URL);

export const redis = new Redis({
  host: env.REDIS_HOST ?? redisUrl.hostname,
  port: env.REDIS_PORT ?? Number(redisUrl.port || 6379),
  ...(redisUrl.username
    ? { username: decodeURIComponent(redisUrl.username) }
    : {}),
  ...(env.REDIS_PASSWORD || redisUrl.password
    ? {
        password: env.REDIS_PASSWORD || decodeURIComponent(redisUrl.password),
      }
    : {}),
  retryStrategy: (attempt) => Math.min(attempt * 50, 2000),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  lazyConnect: env.NODE_ENV === "test",
});

redis.on("error", (error) =>
  logger.error({ err: error }, "Redis client error"),
);
redis.on("close", () => logger.warn("Redis client connection closed"));
redis.on("reconnecting", () => logger.info("Redis client reconnecting"));

export async function waitForRedisReady(timeoutMs = 30_000): Promise<void> {
  if (redis.status === "ready") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Redis to become ready"));
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      redis.off("ready", onReady);
    };
    redis.once("ready", onReady);
  });
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status !== "end") await redis.quit();
}
