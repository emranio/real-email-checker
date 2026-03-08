import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "../../..");

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: toNumber(process.env.PORT, 8081),
  smtpTimeoutSeconds: Math.max(
    2,
    toNumber(process.env.SMTP_TIMEOUT_SECONDS, 20),
  ),
  smtpHeloHost: process.env.SMTP_HELO_HOST || undefined,
  smtpMailFrom: process.env.SMTP_MAIL_FROM || undefined,
  authSignupEnabled: toBoolean(process.env.AUTH_SIGNUP_ENABLED, true),
  jwtSecret:
    process.env.JWT_SECRET || "replace-this-in-production-with-a-long-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  sqliteDbPath:
    process.env.SQLITE_DB_PATH || path.resolve(rootDir, "data", "app.sqlite3"),
  distDir: path.resolve(rootDir, "dist"),
  maxConcurrentRuns: toNumber(process.env.MAX_CONCURRENT_RUNS, 5),
  runWorkerConcurrency: toNumber(process.env.RUN_WORKER_CONCURRENCY, 20),
  schedulerPollMs: toNumber(process.env.SCHEDULER_POLL_MS, 2000),
  dnsTimeoutMs: toNumber(process.env.DNS_TIMEOUT_MS, 5000),
  maxInputEmails: toNumber(process.env.MAX_INPUT_EMAILS, 100000),
};
