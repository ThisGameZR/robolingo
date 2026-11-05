# 2. Reply API first, Push API as fallback

**Status:** accepted

## Context
LINE has two ways to send a message to a user:

| | Reply API | Push API |
| --- | --- | --- |
| Needs | a `replyToken` from the user's webhook event | only the user ID |
| Validity | single use, about **1 minute** after the webhook arrives ("don't rely on the exact limit") | any time |
| Cost | **not counted** toward the message quota | counted (the free plan includes 300 a month) |

([LINE docs: reply tokens](https://developers.line.biz/en/reference/messaging-api/#send-reply-message), [counted messages](https://developers.line.biz/en/docs/messaging-api/pricing/))

A human operator often answers within a minute while a conversation is active, so many replies could be free.

## Decision
- Store the newest reply token per contact, with the time *we received* it.
- When sending, **atomically claim** the token if it's under 50 s old. One SQL statement both reads and clears it (`FOR UPDATE`), so concurrent sends can't both use it.
- Try the Reply API. If LINE answers **400** (token invalid or expired), nothing was delivered, so send with **Push**, using a retry key. On an ambiguous failure (timeout or 5xx), **don't** send with Push, because the reply may already have arrived. Show the error instead.
- Record `delivery = reply | push` on each message, and show it in the UI.

## Consequences
- Saves quota in active conversations, and the UI makes the saving visible.
- Tokens are tracked by **arrival**, not by event timestamp. Comparing LINE's event time with our own server clock dropped fresh tokens when the clocks differed slightly. A test covers this.
- The 50 s window is a deliberate margin under LINE's "about a minute".
