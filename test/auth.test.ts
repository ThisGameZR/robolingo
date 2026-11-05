import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as contactsApi } from "@/app/api/contacts/route";
import { SESSION_COOKIE, checkPassword, sessionToken } from "@/lib/auth";
import { resetDb } from "./helpers";

beforeEach(resetDb);

function loginRequest(password: string, ip = "203.0.113.7") {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ password }),
  });
}

describe("password gate", () => {
  it("checks the password", async () => {
    expect(await checkPassword("correct-horse-battery")).toBe(true);
    expect(await checkPassword("wrong")).toBe(false);
    expect(await checkPassword("")).toBe(false);
  });

  it("sets an HttpOnly session cookie on success", async () => {
    const res = await login(loginRequest("correct-horse-battery"));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=${await sessionToken()}`);
    expect(cookie).toContain("HttpOnly");
  });

  it("protects the API: no cookie or a forged cookie gets 401", async () => {
    const anon = await contactsApi(new Request("http://localhost/api/contacts"));
    expect(anon.status).toBe(401);

    const forged = await contactsApi(
      new Request("http://localhost/api/contacts", {
        headers: { cookie: `${SESSION_COOKIE}=${"0".repeat(64)}` },
      }),
    );
    expect(forged.status).toBe(401);

    const ok = await contactsApi(
      new Request("http://localhost/api/contacts", {
        headers: { cookie: `${SESSION_COOKIE}=${await sessionToken()}` },
      }),
    );
    expect(ok.status).toBe(200);
  });
});

describe("login rate limit", () => {
  it("allows 10 attempts per IP per window, then returns 429 with Retry-After", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await login(loginRequest("wrong"))).status).toBe(401);
    }
    const blocked = await login(loginRequest("correct-horse-battery"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    // Other IPs aren't affected.
    expect((await login(loginRequest("correct-horse-battery", "198.51.100.1"))).status).toBe(200);
  });
});
