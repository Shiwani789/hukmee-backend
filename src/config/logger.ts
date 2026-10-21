import pino from "pino";
import chalk from "chalk";
import { Writable } from "node:stream";
import { STATUS_CODES } from "node:http";
import { env } from "./env";

export function sanitizeLogText(value: string): string {
  return value
    .replace(
      /(\b(?:password|(?:access|refresh)[_-]?token|token|secret|authorization|cookie)\b\s*[:=]\s*)([^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /(\b(?:https?|postgres(?:ql)?|redis):\/\/[^:/\s]+):[^@/\s]+@/gi,
      "$1:[REDACTED]@",
    );
}

function errorDetails(
  value: unknown,
): { type?: string; message?: string; stack?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = value as { type?: unknown; message?: unknown; stack?: unknown };
  if (typeof error.message !== "string") return undefined;
  return {
    ...(typeof error.type === "string" ? { type: error.type } : {}),
    message: sanitizeLogText(error.message),
    ...(typeof error.stack === "string"
      ? { stack: sanitizeLogText(error.stack) }
      : {}),
  };
}

const prettyDevelopmentOutput = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    try {
      const entry = JSON.parse(chunk.toString()) as {
        level?: number;
        msg?: string;
        err?: unknown;
        causeDetails?: unknown;
        req?: { method?: string; url?: string };
        res?: { statusCode?: number };
        responseTime?: number;
        errorMessage?: string;
        requestId?: string;
        time?: number;
      };
      const status = entry.res?.statusCode;

      if (entry.req && typeof status === "number") {
        const method = entry.req.method ?? "HTTP";
        const path = entry.req.url?.split("?")[0] || "/";
        const elapsed =
          typeof entry.responseTime === "number"
            ? `  (${entry.responseTime.toFixed(0)} ms)`
            : "";
        const statusText = STATUS_CODES[status] ?? "Response";
        const icon =
          status >= 500
            ? chalk.red("✖")
            : status >= 400
              ? chalk.yellow("⚠")
              : chalk.green("✓");
        const line = `${icon} ${method} ${path}  ${status} ${statusText}${elapsed}`;
        (status >= 500 ? process.stderr : process.stdout).write(`${line}\n`);

        if (status >= 400) {
          process.stderr.write(
            chalk.gray(
              `  Message : ${sanitizeLogText(entry.errorMessage ?? statusText)}\n`,
            ),
          );
          // pino-http replaces `err` with a synthetic 500-status Error when the
          // response finished without a thrown middleware error. Prefer the
          // original exception captured by the centralized error handler.
          const pinoError = errorDetails(entry.err);
          const syntheticError =
            pinoError?.message === `failed with status code ${status}`;
          const error =
            errorDetails(entry.causeDetails) ??
            (syntheticError ? undefined : pinoError);
          if (status >= 500 && error) {
            process.stderr.write(
              chalk.gray(
                `  Cause   : ${error.type ? `${error.type}: ` : ""}${error.message ?? "Internal error"}\n`,
              ),
            );
            if (error.stack) {
              for (const trace of error.stack.split("\n").slice(1)) {
                process.stderr.write(chalk.gray(`    ${trace.trim()}\n`));
              }
            }
          } else if (status >= 500) {
            process.stderr.write(
              chalk.gray(
                "  Cause   : No exception details were attached to this response.\n",
              ),
            );
          }
          process.stderr.write(
            chalk.gray(`  Request : ${entry.requestId ?? "unavailable"}\n`),
          );
          if (entry.time) {
            process.stderr.write(
              chalk.gray(
                `  Time    : ${new Date(entry.time).toLocaleTimeString("en-GB", { hour12: false })}\n`,
              ),
            );
          }
        }
      } else {
        const level =
          (entry.level ?? 30) >= 50
            ? "error"
            : (entry.level ?? 30) >= 40
              ? "warn"
              : "info";
        const error = errorDetails(entry.err);
        const message =
          [entry.msg, error?.message].filter(Boolean).join(": ") ||
          "Application event";
        const formatted =
          level === "error"
            ? chalk.red(`✖ ERROR: ${message}`)
            : level === "warn"
              ? chalk.yellow(`⚠ WARN: ${message}`)
              : chalk.cyan(`ℹ INFO: ${message}`);
        (level === "error" ? process.stderr : process.stdout).write(
          `${formatted}\n`,
        );
      }
    } catch {
      process.stderr.write("ERROR Unable to format application log\n");
    }
    callback();
  },
});

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    serializers: { err: pino.stdSerializers.err },
    base: { env: env.NODE_ENV },
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.authorization",
      "*.cookie",
      "*.token",
      "*.accessToken",
      "*.access_token",
      "*.password",
      "*.passwordHash",
      "*.password",
      "*.refreshToken",
      "*.refreshTokenHash",
      "*.code",
      "*.otp",
      "*.email",
      "*.phone",
      "*.serialNumber",
      "*.encryptedBankDetails",
      "*.encryptedDocumentNumber",
      "*.documentNumber",
    ],
  },
  env.NODE_ENV === "development" ? prettyDevelopmentOutput : process.stdout,
);

export function logServerStarted(port: number): void {
  if (env.NODE_ENV === "development") {
    console.log(chalk.cyan("╭─────────────────────────────────────────────"));
    console.log(chalk.cyan("│ HUKMEE API"));
    console.log(chalk.cyan(`│ Server running on port ${port}`));
    console.log(chalk.cyan("╰─────────────────────────────────────────────"));
  } else {
    logger.info({ port }, `Hukmee is running on port ${port}`);
  }
}
