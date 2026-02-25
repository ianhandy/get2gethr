import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";

// Lazy singleton — safe for concurrent module evaluation at build time
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (_db) return _db;

  const DB_PATH = path.join(process.cwd(), "group-scheduler.db");
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Inline migrations — CREATE TABLE IF NOT EXISTS is idempotent
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      initiator_email TEXT NOT NULL,
      initiator_name TEXT NOT NULL,
      date_range_start INTEGER NOT NULL,
      date_range_end INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      working_hours_start TEXT NOT NULL DEFAULT '09:00',
      working_hours_end TEXT NOT NULL DEFAULT '17:00',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      exclude_weekends INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'gathering',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      email TEXT NOT NULL,
      name TEXT,
      invite_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      google_access_token TEXT,
      google_refresh_token TEXT,
      availability_json TEXT,
      joined_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS proposed_slots (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      slot_index INTEGER NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed'
    );

    CREATE TABLE IF NOT EXISTS slot_responses (
      id TEXT PRIMARY KEY,
      proposed_slot_id TEXT NOT NULL REFERENCES proposed_slots(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      response TEXT NOT NULL,
      responded_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  _db = drizzle(sqlite, { schema });
  return _db;
}

// Export a proxy so callers can use `db.query.x` naturally
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getDb() as unknown as Record<string, unknown>)[prop as string];
  },
});
