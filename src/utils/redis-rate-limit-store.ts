import type { Options, Store } from "express-rate-limit";
import { RedisStore as RateLimitRedisStore } from "rate-limit-redis";
import { redis } from "../config/redis";

export function createRedisRateLimitStore(prefix: string): Store {
  let options: Options;
  let redisStore: RateLimitRedisStore | undefined;
  const getStore = () => {
    if (redis.status !== "ready")
      throw new Error("Redis must be connected before rate limiting requests");
    if (!redisStore) {
      redisStore = new RateLimitRedisStore({
        prefix,
        sendCommand: async (...args) =>
          (await redis.call(args[0]!, ...args.slice(1))) as
            | string
            | number
            | boolean
            | (string | number | boolean)[],
      });
      redisStore.init(options);
    }
    return redisStore;
  };

  return {
    prefix,
    localKeys: false,
    init: (configuredOptions) => {
      options = configuredOptions;
    },
    get: (key) => getStore().get(key),
    increment: (key) => getStore().increment(key),
    decrement: (key) => getStore().decrement(key),
    resetKey: (key) => getStore().resetKey(key),
  };
}
