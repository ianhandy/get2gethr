import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { migrate } from "./migrations";

// Turso in production, a local libSQL file in development.
export const client: Client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:group-scheduler.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

/**
 * Migrations belong to a deploy step (`npm run db:migrate`), not to module
 * import. Set `AUTO_MIGRATE=1` for local development to run them on first use.
 *
 * When auto-migration is off this is a no-op, so a request never pays for a
 * schema check; when it is on, a failure propagates instead of being logged and
 * swallowed, so a half-migrated database cannot quietly serve traffic.
 */
let autoMigration: Promise<unknown> | null = null;

export async function ensureMigrated(): Promise<void> {
  if (process.env.AUTO_MIGRATE !== "1") return;
  if (!autoMigration) {
    autoMigration = migrate(client).catch((error) => {
      autoMigration = null; // let the next request retry rather than wedge
      throw error;
    });
  }
  await autoMigration;
}

export { migrate };
