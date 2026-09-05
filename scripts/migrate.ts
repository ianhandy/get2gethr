/**
 * Applies schema migrations. Run from a deploy step, before promoting.
 *
 *   npm run db:migrate
 *
 * Exits non-zero on failure so a broken migration stops the deploy rather than
 * leaving a half-migrated database serving traffic.
 */
import { createClient } from "@libsql/client";
import { migrate } from "../lib/db/migrations";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  // Never print the auth token or the full URL with credentials.
  const target = url.startsWith("file:") ? url : new URL(url).host;
  console.log(`Migrating ${target}…`);

  const applied = await migrate(client);
  if (applied.length === 0) {
    console.log("Already up to date.");
  } else {
    for (const id of applied) console.log(`  applied ${id}`);
    console.log(`Applied ${applied.length} migration(s).`);
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
