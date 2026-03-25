import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Turso in production, local SQLite file in dev
const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:group-scheduler.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Inline migrations — run once, idempotent
const migrationPromise = client.batch([
  `CREATE TABLE IF NOT EXISTS events (
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
  )`,
  `CREATE TABLE IF NOT EXISTS participants (
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
  )`,
  `CREATE TABLE IF NOT EXISTS proposed_slots (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    slot_index INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed'
  )`,
  `CREATE TABLE IF NOT EXISTS slot_responses (
    id TEXT PRIMARY KEY,
    proposed_slot_id TEXT NOT NULL REFERENCES proposed_slots(id),
    participant_id TEXT NOT NULL REFERENCES participants(id),
    response TEXT NOT NULL,
    responded_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
], "write").catch(console.error);

/** Await this before any DB operation to ensure tables exist */
export async function ensureMigrated() {
  await migrationPromise;
}

export const db = drizzle(client, { schema });
