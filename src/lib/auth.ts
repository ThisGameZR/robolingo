/**
 * Minimal password gate for the webchat.
 *
 * - APP_PASSWORD set:   the webchat and its APIs need a session cookie.
 * - APP_PASSWORD unset: open in local dev; locked in production
 *   (so a forgotten env var never exposes real users' chats).
 *
 * The cookie holds HMAC(APP_PASSWORD, label), so changing the password
 * signs everyone out. No database table is needed.
 */

export const SESSION_COOKIE = "robolingo_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const LABEL = "robolingo-session-v1";

export type GateMode = "open" | "password" | "misconfigured";

export function gateMode(): GateMode {
  if (process.env.APP_PASSWORD) return "password";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "open";
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Token stored in the cookie after a successful login. */
export async function sessionToken(): Promise<string> {
  return hmacHex(process.env.APP_PASSWORD ?? "", LABEL);
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  // Compare HMACs so the comparison takes the same time whatever the length.
  const [a, b] = await Promise.all([hmacHex(candidate, LABEL), hmacHex(expected, LABEL)]);
  return timingSafeEqual(a, b);
}

export async function isAuthenticated(cookieValue: string | undefined): Promise<boolean> {
  const mode = gateMode();
  if (mode === "open") return true;
  if (mode === "misconfigured" || !cookieValue) return false;
  return timingSafeEqual(cookieValue, await sessionToken());
}

/** For route handlers: returns a 401 response if the request isn't signed in. */
export async function requireAuth(request: Request): Promise<Response | null> {
  const cookie = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (await isAuthenticated(cookie)) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
