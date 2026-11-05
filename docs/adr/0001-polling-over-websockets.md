# 1. Poll for updates instead of WebSockets

**Status:** accepted

## Context
Operators need to see new LINE messages quickly. The app runs on Vercel Functions, which are request/response: they can't keep a WebSocket open, and long-lived streams count against execution time.

## Options
1. **Short polling** (`GET` every few seconds while the tab is visible)
2. **Server-Sent Events** from a function: needs a long-running connection per operator, and still needs a way to fan out across instances
3. **Managed pub/sub** (Ably, Pusher, Supabase Realtime): the webhook publishes and browsers subscribe
4. **Postgres `LISTEN/NOTIFY`** + a long-running service

## Decision
Short polling: 2.5 s for the open conversation and 4 s for the user list, paused while the tab is hidden.

## Consequences
- No extra infrastructure, vendor or secret. Works the same locally and on Vercel.
- A new message appears within about 2.5 s, which is fine for human-to-human chat.
- Idle tabs make roughly 40 cheap requests a minute per operator. That's negligible for a small team, but it grows linearly with operators.
- **When to revisit:** more than about 10 operators online at once, or a need for sub-second delivery. The webhook already has a single place where new messages are written (`saveIncomingMessage`). Publishing an event there to option 3 is a small, contained change, and the UI would swap `usePolling` for a subscription.
