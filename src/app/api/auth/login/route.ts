import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkPassword,
  gateMode,
  sessionToken,
} from "@/lib/auth";

export async function POST(request: Request) {
  if (gateMode() === "misconfigured") {
    return Response.json(
      { error: "APP_PASSWORD is not configured on the server." },
      { status: 503 },
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
