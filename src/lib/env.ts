import { z } from "zod";

/**
 * Typed, validated server configuration.
 *
 * Every variable is format-checked when present. Which ones are *required*
 * depends on where we run: local dev can open the UI with nothing set, while a
 * production server refuses to start without the LINE keys, the webchat
 * password and the database (see src/instrumentation.ts). A misconfigured
 * deployment fails loudly at boot with a clear message, not on the first webhook.
 */
const schema = z.object({
  LINE_CHANNEL_SECRET: z
    .string()
    .regex(/^[0-9a-f]{32}$/, "should be the 32-character hex Channel secret")
    .optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z
    .string()
    .min(100, "looks too short for a long-lived channel access token")
    .optional(),
  APP_PASSWORD: z.string().min(8, "should be at least 8 characters").optional(),
  DATABASE_URL: z.url().optional(),
  LINE_API_BASE_URL: z.url().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  // Treat empty strings (e.g. `APP_PASSWORD=` in .env) as unset.
  const raw = Object.fromEntries(
    Object.keys(schema.shape).map((key) => [key, process.env[key] || undefined]),
  );
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${result.error.issues
        .map((issue) => `  - ${issue.path.join(".")} ${issue.message}`)
        .join("\n")}`,
    );
  }
  cached = result.data;
  return cached;
}

/** For tests: re-read process.env on next access. */
export function resetEnvCache() {
  cached = undefined;
}

const HINTS: Record<string, string> = {
  LINE_CHANNEL_SECRET: "LINE Developers Console → your channel → Basic settings",
  LINE_CHANNEL_ACCESS_TOKEN: "LINE Developers Console → Messaging API → Channel access token",
  APP_PASSWORD: "any password for the webchat login",
  DATABASE_URL: "add a Neon database to the Vercel project (Storage tab)",
};

/** Returns the value or throws an error that says where to get it. */
export function required<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined) {
    throw new Error(`${key} is not set${HINTS[key] ? ` (${HINTS[key]})` : ""}`);
  }
  return value as NonNullable<Env[K]>;
}

/** Called once at server start in production. Throws listing everything missing. */
export function assertProductionEnv() {
  const e = env();
  const needed: (keyof Env)[] = [
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "APP_PASSWORD",
    ...(process.env.VERCEL ? (["DATABASE_URL"] as const) : []),
  ];
  const missing = needed.filter((key) => !e[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing
        .map((key) => `  - ${key}: ${HINTS[key]}`)
        .join("\n")}`,
    );
  }
}
