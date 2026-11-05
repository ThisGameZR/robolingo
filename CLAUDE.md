# Robolingo

An operator webchat for a LINE Official Account, built for a screening test. LINE users message the OA and the messages arrive through the Messaging API webhook. The webchat lists each user (LINE name and picture), and an operator picks one and replies: free Reply API when possible, otherwise Push API.

Requirements from the brief: Next.js + TypeScript, send to and receive from the LINE OA, show who sent each message and let the operator choose who to reply to, public GitHub repo, hosted on Vercel. Architecture decisions are in `docs/adr/`. Read the relevant one before changing that area.

@AGENTS.md

## Stack
- Next.js 16 App Router (`cacheComponents` on), React 19, TypeScript, Tailwind v4, pnpm
- `@line/bot-sdk` v11 (`messagingApi.MessagingApiClient`, `validateSignature`, `webhook.*` types)
- Drizzle ORM. Production uses Neon over HTTP (`DATABASE_URL`). Local dev without `DATABASE_URL` uses PGlite in `node_modules/.cache/robolingo-pglite` (kept out of the source tree so the Turbopack watcher doesn't stall). Tests use PGlite in memory (`PGLITE_DIR=memory://`).
- Vitest for tests, GitHub Actions for CI, Vercel (`sin1`) + Neon (Singapore) for hosting

## Layout
- `src/app/api/line/webhook/route.ts`: LINE webhook (raw-body signature check, then `handleWebhookEvent`; 500 if any event fails)
- `src/app/api/contacts/**`: list users, get/send messages, mark as read, typing indicator
- `src/app/api/media/[messageId]`: streams image/video/file content from LINE (incoming media)
- `src/app/api/uploads` + `src/lib/media.ts` + `src/lib/attachments-client.ts`: outgoing attachments (browser uploads straight to Vercel Blob; send API only accepts URLs in our store)
- `src/app/api/auth/*`, `src/lib/auth.ts`, `src/proxy.ts`: password gate (`APP_PASSWORD`, HMAC cookie); `src/lib/rate-limit.ts`: Postgres rate limiter
- `src/lib/chat.ts`: all domain logic and database access; `src/lib/line.ts`: LINE client and error helpers
- `src/lib/env.ts` + `src/instrumentation.ts`: zod-validated env; production refuses to boot without the required vars
- `src/components/Inbox.tsx`: the whole UI (client component, updates by polling)
- `src/db/schema.ts`: tables `contacts`, `messages`, `rate_limits`; `drizzle/`: generated SQL migrations
- `test/`: integration tests (`helpers.ts` has signed-webhook builders and `mockLine()`)

## Commands
- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test`
- After editing `src/db/schema.ts`, run `pnpm db:generate --name <change>` and commit the new file in `drizzle/`. Vercel applies migrations during `vercel-build`.

## Conventions
- Middleware is called **Proxy** in Next 16 (`src/proxy.ts`). Read `node_modules/next/dist/docs/` before using unfamiliar Next APIs.
- Every API route except the webhook and auth routes calls `requireAuth(request)`. Don't rely on the proxy alone.
- The webhook must stay public and must always validate `x-line-signature` against the raw body.
- **Webhook handlers must be idempotent**, because LINE retries on a 500. Message inserts dedupe on `line_message_id`; follow state is guarded by `follow_changed_at`.
- Reply and read tokens are server-only. Contact queries use `publicContactColumns`; never `select()` whole contact rows into an API response.
- Read config through `env()` / `required()` in `src/lib/env.ts`, not `process.env`, except platform vars like `VERCEL` and `NODE_ENV`.
- Raw SQL (`db.execute`) must work on both Neon HTTP and PGlite; read results from `.rows`.
- Add or update a test in `test/` for any behavior change. Tests must never reach the real LINE API or a real database.
- Never commit secrets. `.env*` is git-ignored except `.env.example`. Locally, `.env.local` (from `vercel link`) contains the **production** `DATABASE_URL`.

## Git
- Personal project: commit as `ThisGameZR <timezazare@gmail.com>` (set locally in this repo). The GitHub remote is under the `ThisGameZR` account. Pushing to `main` deploys to production.
- Keep commit messages short (one line).
