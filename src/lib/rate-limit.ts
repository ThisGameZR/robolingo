import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { rateLimits } = schema;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Fixed-window rate limiter backed by Postgres, so the limit holds across
 * serverless instances (in-memory counters would reset per instance).
 * One atomic upsert per call: no read-then-write race.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const db = await getDb();
  const expired = sql`${rateLimits.windowStart} <= now() - make_interval(secs => ${windowSeconds})`;
  const res = await db.execute<{ count: number; retry_after: number }>(sql`
    insert into ${rateLimits} (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count        = case when ${expired} then 1 else ${rateLimits.count} + 1 end,
      window_start = case when ${expired} then now() else ${rateLimits.windowStart} end
    returning
      count,
      ceil(extract(epoch from (window_start + make_interval(secs => ${windowSeconds}) - now())))::int as retry_after
  `);
  const row = res.rows[0];
  return {
    allowed: Number(row.count) <= limit,
    retryAfterSeconds: Math.max(1, Number(row.retry_after)),
  };
}

/** Client IP as seen by Vercel's edge (first entry of x-forwarded-for). */
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
