# 4. Postgres everywhere: Neon in production, PGlite in dev and tests

**Status:** accepted

## Context
We need durable storage that works on serverless, a local setup with no friction for reviewers, and tests that exercise real SQL. The concurrency logic (atomic token claim, rate limiter) depends on Postgres features, so mocking the database would test nothing.

## Decision
- **Production:** Neon serverless Postgres over HTTP (`@neondatabase/serverless`), created through the Vercel Marketplace in `ap-southeast-1`, with functions pinned to `sin1` next to it. Each request makes several queries, so co-locating them cuts latency.
- **Local dev:** PGlite (Postgres compiled to WASM), stored in `node_modules/.cache` so Turbopack's file watcher ignores it.
- **Tests:** PGlite in memory, with a fresh database per test file.
- **The same Drizzle schema and SQL migrations everywhere.** Migrations run automatically in `vercel-build`, and on first use locally.

## Consequences
- Reviewers can run `pnpm dev` and `pnpm test` with zero setup, and the tests catch real SQL bugs. They found the reply-token clock-skew bug and an empty-password crash.
- Raw SQL is kept portable between the two drivers (`db.execute`, `rows`).
- PGlite adds about 1 s of cold start in dev and tests, which is acceptable.
