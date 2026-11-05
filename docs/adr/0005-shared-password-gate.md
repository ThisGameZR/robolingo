# 5. One shared password instead of operator accounts

**Status:** accepted for this scope, to be revisited for multiple operators

## Context
The inbox shows real users' private messages, so it can't be public. The brief describes one team answering one OA. Full identity (accounts, password resets, SSO) would be most of the work and isn't asked for.

## Decision
- One `APP_PASSWORD`, checked in constant time.
- The session cookie holds `HMAC(password, label)`: HttpOnly, Secure, SameSite=Lax, 30 days. There's no session table, and changing the password signs everyone out.
- Fail closed: in production, a missing password locks the app instead of opening it.
- Two layers: `proxy.ts` redirects pages, and every API route checks the session itself.
- Login is rate-limited per IP in Postgres (10 attempts per 15 minutes), because in-memory counters don't work across serverless instances.

## Consequences
- No record of *which* operator sent a message, and no individual revocation.
- **Upgrade path:** Auth.js with Google/LINE Login, or the company's SSO. Add `operator_id` to outgoing messages and an audit log. The `requireAuth(request)` boundary already exists in every route, so the change stays local to `lib/auth.ts`.
