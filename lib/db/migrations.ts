import type { Client } from "@libsql/client";

/**
 * Ordered, named schema migrations.
 *
 * Migrations run from an explicit deploy step (`npm run db:migrate`), not as a
 * side effect of importing a module, and a failure is fatal rather than logged
 * and ignored. Every migration is recorded in `_migrations` so it runs once.
 */
export interface Migration {
  id: string;
  up: (client: Client) => Promise<void>;
}

async function run(client: Client, statements: string[]): Promise<void> {
  await client.batch(statements, "write");
}

/** Adds a column only when it is absent, so re-runs on a partial DB are safe. */
async function addColumnIfMissing(
  client: Client,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const exists = info.rows.some((row) => row.name === column);
  if (exists) return;
  await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export const MIGRATIONS: Migration[] = [
  {
    // The shape the app shipped with. `IF NOT EXISTS` makes this a no-op on a
    // database that already has data.
    id: "001_baseline",
    up: (client) =>
      run(client, [
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
      ]),
  },

  {
    // Local-date window semantics, explicit organizer role, durable state, and
    // the calendar-write bookkeeping the confirmation path needs.
    id: "002_release_readiness",
    up: async (client) => {
      // --- events -------------------------------------------------------
      // Local calendar dates in the event timezone are now the source of
      // truth; the unix columns stay as a derived index for range queries.
      await addColumnIfMissing(client, "events", "start_date", "TEXT");
      await addColumnIfMissing(client, "events", "end_date", "TEXT");
      await addColumnIfMissing(client, "events", "organizer_token", "TEXT");
      await addColumnIfMissing(client, "events", "confirmed_slot_id", "TEXT");
      await addColumnIfMissing(
        client,
        "events",
        "calendar_write_status",
        "TEXT NOT NULL DEFAULT 'not_attempted'"
      );
      await addColumnIfMissing(client, "events", "calendar_write_error", "TEXT");
      await addColumnIfMissing(client, "events", "external_event_id", "TEXT");
      await addColumnIfMissing(client, "events", "response_deadline", "INTEGER");
      await addColumnIfMissing(
        client,
        "events",
        "nonresponder_policy",
        "TEXT NOT NULL DEFAULT 'wait'"
      );
      await addColumnIfMissing(client, "events", "idempotency_key", "TEXT");
      await addColumnIfMissing(client, "events", "created_by_ip_hash", "TEXT");
      await addColumnIfMissing(
        client,
        "events",
        "updated_at",
        "INTEGER NOT NULL DEFAULT 0"
      );
      await addColumnIfMissing(client, "events", "cancelled_at", "INTEGER");

      // --- participants --------------------------------------------------
      await addColumnIfMissing(
        client,
        "participants",
        "role",
        "TEXT NOT NULL DEFAULT 'attendee'"
      );
      await addColumnIfMissing(client, "participants", "connection_id", "TEXT");
      await addColumnIfMissing(client, "participants", "invited_at", "INTEGER");
      await addColumnIfMissing(client, "participants", "last_reminded_at", "INTEGER");
      await addColumnIfMissing(client, "participants", "removed_at", "INTEGER");

      // --- proposed_slots -------------------------------------------------
      // `slot_index` becomes a stable deterministic rank, and slots start life
      // queued so "next in line" is distinguishable from "asked about".
      await addColumnIfMissing(client, "proposed_slots", "proposed_at", "INTEGER");
      await addColumnIfMissing(client, "proposed_slots", "decided_at", "INTEGER");

      await run(client, [
        // Backfill local dates for rows created before this migration. Doing it
        // in UTC is the best available reconstruction and is only ever applied
        // to pre-existing rows.
        `UPDATE events
           SET start_date = date(date_range_start, 'unixepoch')
         WHERE start_date IS NULL`,
        `UPDATE events
           SET end_date = date(date_range_end, 'unixepoch')
         WHERE end_date IS NULL`,
        `UPDATE events SET updated_at = created_at WHERE updated_at = 0`,
        // Existing events predate organizer tokens; give each a derived one so
        // the management surface stays reachable rather than silently 403ing.
        `UPDATE events
           SET organizer_token = lower(hex(randomblob(24)))
         WHERE organizer_token IS NULL`,

        // --- new tables -------------------------------------------------
        `CREATE TABLE IF NOT EXISTS calendar_connections (
          id TEXT PRIMARY KEY,
          participant_id TEXT NOT NULL REFERENCES participants(id),
          provider TEXT NOT NULL,
          broker TEXT NOT NULL DEFAULT 'google',
          account_email TEXT,
          broker_profile_id TEXT,
          broker_account_id TEXT,
          source_calendar_ids TEXT NOT NULL DEFAULT '[]',
          destination_calendar_id TEXT,
          status TEXT NOT NULL DEFAULT 'connected',
          access_token TEXT,
          refresh_token TEXT,
          token_expires_at INTEGER,
          last_synced_at INTEGER,
          last_error TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS calendar_connections_participant_idx
           ON calendar_connections(participant_id)`,

        `CREATE TABLE IF NOT EXISTS oauth_states (
          id TEXT PRIMARY KEY,
          participant_id TEXT NOT NULL REFERENCES participants(id),
          event_id TEXT NOT NULL REFERENCES events(id),
          provider TEXT NOT NULL,
          code_verifier TEXT,
          return_to TEXT NOT NULL,
          client_kind TEXT NOT NULL DEFAULT 'web',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx
           ON oauth_states(expires_at)`,

        `CREATE TABLE IF NOT EXISTS email_deliveries (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES events(id),
          participant_id TEXT,
          kind TEXT NOT NULL,
          to_email TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          provider_message_id TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_idempotency_idx
           ON email_deliveries(idempotency_key)`,

        `CREATE TABLE IF NOT EXISTS rate_limit_buckets (
          id TEXT PRIMARY KEY,
          window_start INTEGER NOT NULL,
          count INTEGER NOT NULL DEFAULT 0
        )`,

        // --- constraints that make retries and races safe ----------------
        `CREATE UNIQUE INDEX IF NOT EXISTS slot_responses_unique_idx
           ON slot_responses(proposed_slot_id, participant_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS proposed_slots_rank_idx
           ON proposed_slots(event_id, slot_index)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS events_organizer_token_idx
           ON events(organizer_token)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS events_idempotency_idx
           ON events(idempotency_key)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS participants_event_email_idx
           ON participants(event_id, email)`,
        `CREATE INDEX IF NOT EXISTS participants_event_idx
           ON participants(event_id)`,
        `CREATE INDEX IF NOT EXISTS proposed_slots_event_status_idx
           ON proposed_slots(event_id, status)`,
      ]);
    },
  },
];

/** Applies any migration not yet recorded. Throws on the first failure. */
export async function migrate(client: Client): Promise<string[]> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`
  );

  const applied = await client.execute("SELECT id FROM _migrations");
  const done = new Set(applied.rows.map((row) => String(row.id)));

  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    await migration.up(client);
    await client.execute({
      sql: "INSERT INTO _migrations (id) VALUES (?)",
      args: [migration.id],
    });
    ran.push(migration.id);
  }
  return ran;
}
