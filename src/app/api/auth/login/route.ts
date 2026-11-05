import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkPassword,
  gateMode,
  sessionToken,
} from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (gateMode() === "misconfigured") {
    return Response.json(
      { error: "APP_PASSWORD is not configured on the server." },
      { status: 503 },
    );
  }

  // Slow down password guessing: 10 attempts per IP per 15 minutes.
  const limit = await rateLimit(`login:${clientIp(request)}`, 10, 15 * 60);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!(await checkPassword(password))) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  const cookie = [
    `${SESSION_COOKIE}=${await sessionToken()}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
