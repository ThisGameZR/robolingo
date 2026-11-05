import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthenticated } from "@/lib/auth";

/**
 * Sends signed-out visitors to /login. The API routes also check the session
 * themselves (requireAuth), so this is a convenience, not the only guard.
 */
export async function proxy(request: NextRequest) {
  const ok = await isAuthenticated(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except: the LINE webhook (LINE can't log in), login/logout,
  // the login page and static assets.
  matcher: [
    "/((?!api/line/webhook|api/auth/|login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
