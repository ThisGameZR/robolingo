// Applies the SQL migrations in ./drizzle to the Neon database in DATABASE_URL.
// Runs automatically during the Vercel build (see "vercel-build" in package.json).
// Local dev with PGlite does not need this: migrations run on first request.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL not set, skipping.");
  process.exit(0);
}

await migrate(drizzle(neon(url)), { migrationsFolder: "./drizzle" });
console.log("[migrate] Database is up to date.");
