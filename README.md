# Robolingo: LINE OA Webchat

A webchat for a **LINE Official Account**. When LINE users message the OA, their messages show up here. You can see who each sender is (LINE name and profile picture), pick a user, and reply. The reply arrives in their LINE app as a message from the OA.

Built with **Next.js 16 (App Router) + TypeScript**, Tailwind CSS, the official [`@line/bot-sdk`](https://github.com/line/line-bot-sdk-nodejs), Drizzle ORM and **Neon Postgres**. It's hosted on **Vercel**.

## Features

- **Receive** messages from LINE through the Messaging API webhook. The LINE signature is checked on every request.
- **See who's talking**: a user list with LINE display name, profile picture, last message, unread badge and search.
- **Pick a user and reply**. Replies go out through the LINE Push API, and failed sends show the reason.
- Text, stickers, images (shown inline), video/audio/file links and locations
- Shows when a user has blocked the OA
- Updates every few seconds while the tab is open
- Password-protected, so a public URL doesn't expose users' chats
- Works on mobile: the user list and the chat take turns on small screens

## How it works

```
LINE user ──message──▶ LINE Platform ──webhook──▶ POST /api/line/webhook ──▶ Postgres
                                                     (signature check,
                                                      fetch profile)
Webchat (browser) ◀── checks every few seconds ── GET /api/contacts, /api/contacts/:id/messages
Webchat (browser) ──reply──▶ POST /api/contacts/:id/messages ──Push API──▶ LINE user
```

| Path | What it does |
| --- | --- |
| `src/app/api/line/webhook/route.ts` | LINE webhook: checks the signature and saves users and messages |
| `src/lib/chat.ts` | Reading and writing the database, sending through the Push API |
| `src/lib/line.ts` | LINE API client |
| `src/lib/auth.ts`, `src/proxy.ts` | Password gate |
| `src/components/Inbox.tsx` | The webchat UI |
| `src/db/schema.ts`, `drizzle/` | Database schema and migrations |

## Run locally

You need Node.js 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # fill in the LINE keys (optional to just open the UI)
pnpm dev
```

Then open http://localhost:3000.

- No database setup is needed locally. Without `DATABASE_URL`, the app uses an embedded Postgres (PGlite) stored in `./.pglite`.
- Without `APP_PASSWORD`, the login screen is skipped locally.
- LINE can't reach `localhost`. To receive real LINE messages locally, expose port 3000 with a tunnel (`ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`) and set the tunnel URL plus `/api/line/webhook` as the webhook URL.

Other scripts: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm db:generate` (creates a migration after you edit `src/db/schema.ts`), `pnpm db:migrate`.

## Deploy (LINE + Vercel + Neon)

### 1. Create the LINE Official Account and Messaging API channel
1. Create an OA at https://manager.line.biz.
2. In OA Manager → **Settings → Messaging API**, click **Enable Messaging API** and choose or create a provider.
3. In the [LINE Developers Console](https://developers.line.biz/console/), open the channel:
   - **Basic settings** → copy the **Channel secret**.
   - **Messaging API** → **Channel access token (long-lived)** → **Issue**, then copy it.
4. In OA Manager → **Settings → Response settings**: turn **Webhooks** *on* and **Auto-response messages** / **Greeting message** *off*, so LINE doesn't answer before you do.

### 2. Deploy to Vercel
1. Push this repo to GitHub.
2. At https://vercel.com/new, import the repo. Leave the framework as Next.js and keep the default build settings.
3. In the project, go to **Storage → Create Database → Neon** and connect it to the project. This sets `DATABASE_URL`.
4. **Settings → Environment Variables**: add `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` and `APP_PASSWORD`.
5. **Redeploy.** The build runs the database migrations automatically (the `vercel-build` script).

### 3. Connect the webhook
1. LINE Developers Console → **Messaging API** → **Webhook URL**: `https://<your-app>.vercel.app/api/line/webhook`
2. Click **Verify**. It should say *Success*.
3. Turn on **Use webhook**.
4. Add the OA as a friend (QR code or `https://line.me/R/ti/p/@<basic-id>`), send it a message, and it appears in the webchat.

### Free plan limits
The LINE free plan includes about 300 push messages a month. Received messages are unlimited. Neon and Vercel free plans are more than enough for this.

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `LINE_CHANNEL_SECRET` | yes | Checks that webhooks really come from LINE |
| `LINE_CHANNEL_ACCESS_TOKEN` | yes | Calls the LINE API (push, profile, content) |
| `APP_PASSWORD` | in production | Webchat login. Without it, the deployed app stays locked. |
| `DATABASE_URL` | in production | Neon Postgres. Local dev falls back to PGlite. |
| `LINE_API_BASE_URL` | no | Points LINE API calls at a mock server, for tests |
