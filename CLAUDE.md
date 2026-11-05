# Robolingo

A webchat for a LINE Official Account, built for a screening test. LINE users message the OA and the messages arrive through the Messaging API webhook. The webchat lists each user (LINE name and picture), and an operator picks one and replies through the Push API.

Requirements from the brief: Next.js + TypeScript, send to and receive from the LINE OA, show who sent each message and let the operator choose who to reply to, public GitHub repo, hosted on Vercel.

@AGENTS.md

## Stack
- Next.js 16 App Router (`cacheComponents` on), React 19, TypeScript, Tailwind v4, pnpm
- `@line/bot-sdk` v11 (`messagingApi.MessagingApiClient`, `validateSignature`, `webhook.*` types)
- Drizzle ORM. Production uses Neon over HTTP (`DATABASE_URL`). Local dev without `DATABASE_URL` uses PGlite in `node_modules/.cache/robolingo-pglite` (kept out of the source tree so the Turbopack watcher does not stall), with migrations applied automatically.

## Layout
- `src/app/api/line/webhook/route.ts`: LINE webhook (signature check, then `handleWebhookEvent`)
- `src/app/api/contacts/**`: list users, get/send messages, mark as read
- `src/app/api/media/[messageId]`: streams image/video/file content from LINE
- `src/app/api/auth/*`, `src/lib/auth.ts`, `src/proxy.ts`: password gate (`APP_PASSWORD`, HMAC cookie)
- `src/lib/chat.ts`: all database reads/writes and push sending; `src/lib/line.ts`: LINE client
- `src/components/Inbox.tsx`: the whole UI (client component, updates by polling)
- `src/db/schema.ts`: tables `contacts` and `messages`; `drizzle/`: generated SQL migrations

## Commands
- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck`
- After editing `src/db/schema.ts`, run `pnpm db:generate` and commit the new file in `drizzle/`. Vercel applies migrations during `vercel-build`.

## Conventions
- Middleware is called **Proxy** in Next 16 (`src/proxy.ts`). Read `node_modules/next/dist/docs/` before using unfamiliar Next APIs.
- Every API route except the webhook and auth routes calls `requireAuth(request)`. Don't rely on the proxy alone.
- The webhook must stay public and must always validate `x-line-signature` against the raw body.
- Incoming messages are de-duplicated by `line_message_id` (unique), because LINE can redeliver webhooks.
- Never commit secrets. `.env*` is git-ignored except `.env.example`.

## Git
- Personal project: commit as `ThisGameZR <timezazare@gmail.com>` (set locally in this repo). The GitHub remote is under the `ThisGameZR` account.
