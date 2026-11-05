import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

let dbPromise: Promise<Db> | undefined;

/**
 * Production (Vercel): DATABASE_URL points to Neon Postgres and we use Neon's
 * HTTP driver, which suits serverless functions.
 *
 * Local dev without DATABASE_URL: an embedded Postgres (PGlite) stored in
 * node_modules/.cache/robolingo-pglite, with migrations applied on first use.
 * No setup needed. Delete that folder to reset local data.
 */
export function getDb(): Promise<Db> {
  dbPromise ??= createDb().catch((err) => {
    dbPromise = undefined; // don't cache a failed start-up; retry on the next request
    throw err;
  });
  return dbPromise;
}

async function createDb(): Promise<Db> {
  const url = env().DATABASE_URL;
  if (url) {
    return drizzleNeon(neon(url), { schema });
  }

  if (process.env.VERCEL) {
    throw new Error(
      "DATABASE_URL is not set. Add a Neon Postgres database to the Vercel project.",
    );
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");

  // Kept under node_modules/.cache: a data folder inside the source tree makes
  // Turbopack's file watcher stall on every database write in `next dev`.
  const dataDir =
    process.env.PGLITE_DIR ||
    path.join(process.cwd(), "node_modules", ".cache", "robolingo-pglite");
  // PGlite won't create parent folders. "memory://" (used by tests) needs none.
  if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  // Both drivers expose the same query builder API.
  return db as unknown as Db;
}

export { schema };
