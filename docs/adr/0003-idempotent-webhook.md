# 3. Idempotent webhook handling, and letting LINE retry

**Status:** accepted

## Context
LINE delivers webhook events at least once: with redelivery turned on, a non-2xx response causes a retry, and redelivered events are flagged `isRedelivery`. Events can also arrive out of order. The first version logged failures and always returned 200, which silently lost events whenever the database had a problem.

## Decision
- Process every event in the batch. If **any** failed, return **500**, so LINE redelivers the batch.
- Make every handler safe to run twice:
  - **Messages:** `line_message_id` is unique and inserts use `ON CONFLICT DO NOTHING`. Side effects (unread count, preview) only run when a row was actually inserted.
  - **Follow / unfollow:** only applied if the event is newer than `follow_changed_at`. An old redelivered `follow` can't undo a later `unfollow`.
  - **Preview / last message:** only moves forward in time.
  - **Unsend:** setting `unsent_at` and clearing the content gives the same result however many times it runs.
- Log failures as JSON with `webhookEventId` and `isRedelivery`, so they can be correlated.

## Consequences
- A temporary database outage delays messages but doesn't lose them (with redelivery enabled in the LINE console).
- Processing stays synchronous: it takes about 100–300 ms, well within LINE's timeout. If bursts grow, the same handlers can run from a queue (see the scaling path in the README).
- Tests cover duplicates, out-of-order events, a batch with one bad event (500, others saved) and retrying that batch (no duplicates).
