import "server-only";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

let dbPromise: Promise<Db> | undefined;

/**
 * Production (Vercel): DATABASE_URL points to Neon Postgres and we use Neon's
 * HTTP driver, which suits serverless functions.
 *
 * Local dev without DATABASE_URL: an embedded Postgres (PGlite) stored in
 * ./.pglite, with migrations applied on first use. No setup needed.
 */
export function getDb(): Promise<Db> {
  dbPromise ??= createDb();
  return dbPromise;
}

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
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

  const client = new PGlite(path.join(process.cwd(), ".pglite"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  // Both drivers expose the same query builder API.
  return db as unknown as Db;
}

export { schema };
