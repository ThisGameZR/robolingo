import { afterEach, describe, expect, it } from "vitest";
import { assertProductionEnv, env, required, resetEnvCache } from "@/lib/env";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("environment validation", () => {
  it("rejects a malformed channel secret with a clear message", () => {
    process.env.LINE_CHANNEL_SECRET = "not-a-secret";
    resetEnvCache();
    expect(() => env()).toThrow(/LINE_CHANNEL_SECRET should be the 32-character hex/);
  });

  it("treats empty values as unset and says where to get them", () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "";
    resetEnvCache();
    expect(() => required("LINE_CHANNEL_ACCESS_TOKEN")).toThrow(/Messaging API/);
  });

  it("refuses to boot in production without the required variables", () => {
    delete process.env.APP_PASSWORD;
    process.env.VERCEL = "1";
    resetEnvCache();
    expect(() => assertProductionEnv()).toThrow(/APP_PASSWORD[\s\S]*DATABASE_URL/);
  });
});
