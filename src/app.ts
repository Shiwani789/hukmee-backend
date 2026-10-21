import express from "express";
import path from "node:path";
import session from "express-session";
import { randomUUID } from "node:crypto";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import openapi from "./config/openapi";
import { env } from "./config/env";
import { logger, sanitizeLogText } from "./config/logger";
import { AppError } from "./utils/errors";
import { requestId } from "./middlewares/request-id";
import { errorHandler, notFound } from "./middlewares/errors";
import { standardizeApiResponse } from "./middlewares/api-response";
import { sendRateLimitResponse } from "./utils/rate-limit-response";
import { errorResponse } from "./utils/error-response";
import { redis } from "./config/redis";
import { prisma } from "./config/database";
import { RedisSessionStore } from "./utils/redis-session-store";
import { createRedisRateLimitStore } from "./utils/redis-rate-limit-store";
import routes from "./routes";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestId);
app.use(standardizeApiResponse);
app.use(
  pinoHttp({
    logger,
    genReqId: (_req, res) => String(res.getHeader("x-request-id")),
    serializers: {
      req: (req: express.Request) => ({
        id: req.id,
        method: req.method,
        url: (req.originalUrl || req.url || "/").split("?")[0] || "/",
      }),
      res: (res: express.Response) => ({ statusCode: res.statusCode }),
    },
    customProps: (_req, res) => ({
      requestId: res.locals.requestId,
      ...(typeof res.locals.errorMessage === "string"
        ? { errorMessage: sanitizeLogText(res.locals.errorMessage) }
        : {}),
      ...(typeof res.locals.errorCode === "string"
        ? { errorCode: res.locals.errorCode }
        : {}),
      ...(res.locals.logError ? { causeDetails: res.locals.logError } : {}),
    }),
    ...(env.NODE_ENV === "development"
      ? {
          customLogLevel: (
            _req: express.Request,
            res: express.Response,
            error: Error | undefined,
          ) => {
            if (error || res.statusCode >= 500) return "error" as const;
            if (res.statusCode >= 400) return "warn" as const;
            return "info" as const;
          },
          customSuccessMessage: (req: express.Request, res: express.Response) =>
            `${req.method} ${req.originalUrl?.split("?")[0] ?? "/"} - ${res.statusCode}`,
          customErrorMessage: (req: express.Request, res: express.Response) =>
            `${req.method} ${req.originalUrl?.split("?")[0] ?? "/"} - ${res.statusCode}`,
        }
      : {}),
  }),
);
app.use(helmet());
const allowedOrigins = new Set(
  env.CORS_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else
        callback(
          new AppError(403, "CORS_ORIGIN_DENIED", "Origin is not allowed"),
        );
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb", type: "application/json" }));
app.use(
  session({
    name: "connect.sid",
    genid: () => randomUUID(),
    ...(env.NODE_ENV === "test"
      ? {}
      : {
          store: new RedisSessionStore(),
        }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(env.NODE_ENV === "test"
      ? {}
      : {
          store: createRedisRateLimitStore("hukmee:rl:global:"),
        }),
    handler: (_req, res) => sendRateLimitResponse(res),
  }),
);
app.get("/health/live", (_req, res) => res.json({ data: { status: "ok" } }));
app.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ data: { status: "ready" } });
  } catch {
    errorResponse(
      res,
      503,
      "NOT_READY",
      "The service is temporarily unavailable.",
    );
  }
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));
app.use("/api/v1", routes);
app.use("/api", routes);
app.use(
  "/uploads/profiles",
  express.static(path.resolve(process.cwd(), "uploads", "profiles"), {
    fallthrough: false,
    immutable: true,
    maxAge: "1d",
  }),
);
app.use(
  "/uploads/catalog",
  (_req, res, next) => {
    // Admin and customer apps load public catalog images from a different origin.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.resolve(process.cwd(), "uploads", "catalog"), {
    fallthrough: false,
    immutable: true,
    maxAge: "1d",
  }),
);
app.use(notFound);
app.use(errorHandler);

export default app;
