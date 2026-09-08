import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Event lifecycle.
 *
 * `scheduling` is deliberately distinct from `confirmed`: everyone has agreed,
 * but the meeting does not exist on a calendar yet. Only a successful calendar
 * write moves an event to `confirmed`, so the word never over-promises.
 * `action_required` is the terminal-but-recoverable state for an event that
 * needs a human — a lost calendar grant, a failed write, a stalled invitee.
 */
export const EVENT_STATUSES = [
  "draft",
  "gathering",
  "proposing",
  "scheduling",
  "confirmed",
  "action_required",
  "failed",
  "cancelled",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const CALENDAR_WRITE_STATUSES = [
  "not_attempted",
  "pending",
  "written",
  "failed",
] as const;
export type CalendarWriteStatus = (typeof CALENDAR_WRITE_STATUSES)[number];

export const PARTICIPANT_ROLES = ["organizer", "attendee"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const PARTICIPANT_STATUSES = ["pending", "joined", "declined", "removed"] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

/**
 * Slot lifecycle. `queued` is the state every generated slot starts in, so the
 * one slot currently being asked about is unambiguous.
 */
export const SLOT_STATUSES = [
  "queued",
  "proposed",
  "confirmed",
  "rejected",
  "expired",
] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const CONNECTION_STATUSES = [
  "connected",
  "relink_required",
  "revoked",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const NONRESPONDER_POLICIES = ["wait", "proceed_without"] as const;
export type NonresponderPolicy = (typeof NONRESPONDER_POLICIES)[number];

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    // Columns keep their original names so existing rows survive; the app
    // vocabulary is "organizer" everywhere else.
    organizerEmail: text("initiator_email").notNull(),
    organizerName: text("initiator_name").notNull(),
    /** Bearer capability for the organizer's management surface. */
    organizerToken: text("organizer_token").notNull(),

    /** Inclusive local calendar dates in `timezone` — the source of truth. */
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    /** Derived UTC bounds, kept for range queries. Never authoritative. */
    dateRangeStart: integer("date_range_start").notNull(),
    dateRangeEnd: integer("date_range_end").notNull(),

    durationMinutes: integer("duration_minutes").notNull(),
    workingHoursStart: text("working_hours_start").notNull().default("09:00"),
    workingHoursEnd: text("working_hours_end").notNull().default("17:00"),
    timezone: text("timezone").notNull().default("America/New_York"),
    excludeWeekends: integer("exclude_weekends", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Monday-first, 7 × 24 hourly cells. Null keeps legacy events compatible. */
    weeklyAvailabilityJson: text("weekly_availability_json"),

    status: text("status", { enum: EVENT_STATUSES }).notNull().default("gathering"),
    confirmedSlotId: text("confirmed_slot_id"),
    calendarWriteStatus: text("calendar_write_status", {
      enum: CALENDAR_WRITE_STATUSES,
    })
      .notNull()
      .default("not_attempted"),
    calendarWriteError: text("calendar_write_error"),
    /** Provider/broker identifier for the meeting once it exists. */
    externalEventId: text("external_event_id"),

    responseDeadline: integer("response_deadline"),
    nonresponderPolicy: text("nonresponder_policy", { enum: NONRESPONDER_POLICIES })
      .notNull()
      .default("wait"),

    idempotencyKey: text("idempotency_key"),
    createdByIpHash: text("created_by_ip_hash"),
    cancelledAt: integer("cancelled_at"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("events_organizer_token_idx").on(table.organizerToken),
    uniqueIndex("events_idempotency_idx").on(table.idempotencyKey),
  ]
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    email: text("email").notNull(),
    name: text("name"),
    /** The organizer is a participant row too, so their calendar is included. */
    role: text("role", { enum: PARTICIPANT_ROLES }).notNull().default("attendee"),
    inviteToken: text("invite_token").notNull().unique(),
    status: text("status", { enum: PARTICIPANT_STATUSES })
      .notNull()
      .default("pending"),
    connectionId: text("connection_id"),
    invitedAt: integer("invited_at"),
    lastRemindedAt: integer("last_reminded_at"),
    removedAt: integer("removed_at"),
    joinedAt: integer("joined_at"),

    /**
     * Legacy direct-Google token columns. New connections live in
     * `calendar_connections`; these remain only so pre-migration rows can be
     * read and re-homed.
     */
    googleAccessToken: text("google_access_token"),
    googleRefreshToken: text("google_refresh_token"),
    availabilityJson: text("availability_json"),
  },
  (table) => [
    uniqueIndex("participants_event_email_idx").on(table.eventId, table.email),
    index("participants_event_idx").on(table.eventId),
  ]
);

export const calendarConnections = sqliteTable(
  "calendar_connections",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    /** The end-user's calendar system: google | microsoft | apple | exchange. */
    provider: text("provider").notNull(),
    /** How we reach it: `google` direct, or a broker such as `cronofy`. */
    broker: text("broker").notNull().default("google"),
    accountEmail: text("account_email"),
    brokerProfileId: text("broker_profile_id"),
    brokerAccountId: text("broker_account_id"),
    /** JSON array of calendar ids that contribute busy time. */
    sourceCalendarIds: text("source_calendar_ids").notNull().default("[]"),
    /** Where a confirmed meeting gets written. Organizer connections only. */
    destinationCalendarId: text("destination_calendar_id"),
    status: text("status", { enum: CONNECTION_STATUSES }).notNull().default("connected"),
    /** Populated only for direct providers; a broker holds its own tokens. */
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: integer("token_expires_at"),
    lastSyncedAt: integer("last_synced_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("calendar_connections_participant_idx").on(table.participantId),
  ]
);

/**
 * Short-lived, single-use authorization state.
 *
 * The invite token is a long-lived bearer capability and must never double as
 * OAuth state: a forwarded invite link would then let anyone attach their own
 * calendar to someone else's participant row.
 */
export const oauthStates = sqliteTable(
  "oauth_states",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    provider: text("provider").notNull(),
    codeVerifier: text("code_verifier"),
    returnTo: text("return_to").notNull(),
    /** `web` or `ios`, so the callback returns to the surface that started it. */
    clientKind: text("client_kind").notNull().default("web"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (table) => [index("oauth_states_expiry_idx").on(table.expiresAt)]
);

export const proposedSlots = sqliteTable(
  "proposed_slots",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    /** Deterministic rank from the availability engine; 0 is proposed first. */
    rank: integer("slot_index").notNull(),
    startTime: integer("start_time").notNull(),
    endTime: integer("end_time").notNull(),
    status: text("status", { enum: SLOT_STATUSES }).notNull().default("queued"),
    proposedAt: integer("proposed_at"),
    decidedAt: integer("decided_at"),
  },
  (table) => [
    uniqueIndex("proposed_slots_rank_idx").on(table.eventId, table.rank),
    index("proposed_slots_event_status_idx").on(table.eventId, table.status),
  ]
);

export const slotResponses = sqliteTable(
  "slot_responses",
  {
    id: text("id").primaryKey(),
    proposedSlotId: text("proposed_slot_id")
      .notNull()
      .references(() => proposedSlots.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    response: text("response", { enum: ["confirmed", "declined"] }).notNull(),
    respondedAt: integer("responded_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    // One response per person per slot: the constraint, not a prior read, is
    // what makes a duplicated callback safe.
    uniqueIndex("slot_responses_unique_idx").on(
      table.proposedSlotId,
      table.participantId
    ),
  ]
);

export const EMAIL_KINDS = [
  "invite",
  "proposal",
  "confirmation",
  "no_slots",
  "cancelled",
  "reminder",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_STATUSES = ["pending", "sent", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Delivery ledger, so a failed send is visible and resendable. */
export const emailDeliveries = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    participantId: text("participant_id"),
    kind: text("kind", { enum: EMAIL_KINDS }).notNull(),
    toEmail: text("to_email").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: EMAIL_STATUSES }).notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [uniqueIndex("email_deliveries_idempotency_idx").on(table.idempotencyKey)]
);

/** Fixed-window counters backing the abuse limits on public endpoints. */
export const rateLimitBuckets = sqliteTable("rate_limit_buckets", {
  id: text("id").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type NewCalendarConnection = typeof calendarConnections.$inferInsert;
export type OAuthState = typeof oauthStates.$inferSelect;
export type ProposedSlot = typeof proposedSlots.$inferSelect;
export type NewProposedSlot = typeof proposedSlots.$inferInsert;
export type SlotResponse = typeof slotResponses.$inferSelect;
export type NewSlotResponse = typeof slotResponses.$inferInsert;
export type EmailDelivery = typeof emailDeliveries.$inferSelect;
