import { env } from "./config/env";
import { logger, logServerStarted } from "./config/logger";
import { prisma } from "./config/database";
import { disconnectRedis, waitForRedisReady } from "./config/redis";
import app from "./app";

export { app };
export default app;

if (env.NODE_ENV !== "test") {
  void (async () => {
    await waitForRedisReady();
    const server = app.listen(env.PORT, () => logServerStarted(env.PORT));
    const shutdown = (signal: string) => {
      logger.info({ signal }, "shutting down");
      server.close(() => {
        void Promise.all([disconnectRedis(), prisma.$disconnect()]).finally(
          () => process.exit(0),
        );
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })().catch((error: unknown) => {
    logger.fatal(
      { err: error },
      "Unable to connect to Redis; API startup aborted",
    );
    process.exit(1);
  });
}
