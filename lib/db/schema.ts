import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  initiatorEmail: text("initiator_email").notNull(),
  initiatorName: text("initiator_name").notNull(),
  dateRangeStart: integer("date_range_start").notNull(), // Unix timestamp UTC
  dateRangeEnd: integer("date_range_end").notNull(),     // Unix timestamp UTC
  durationMinutes: integer("duration_minutes").notNull(),
  workingHoursStart: text("working_hours_start").notNull().default("09:00"),
  workingHoursEnd: text("working_hours_end").notNull().default("17:00"),
  timezone: text("timezone").notNull().default("America/New_York"),
  excludeWeekends: integer("exclude_weekends", { mode: "boolean" }).notNull().default(true),
  status: text("status", {
    enum: ["gathering", "proposing", "confirmed", "failed"],
  })
    .notNull()
    .default("gathering"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  email: text("email").notNull(),
  name: text("name"),
  inviteToken: text("invite_token").notNull().unique(),
  status: text("status", { enum: ["pending", "joined", "declined"] })
    .notNull()
    .default("pending"),
  googleAccessToken: text("google_access_token"),   // encrypted
  googleRefreshToken: text("google_refresh_token"), // encrypted
  availabilityJson: text("availability_json"),       // JSON: [[startMs, endMs], ...]
  joinedAt: integer("joined_at"),
});

export const proposedSlots = sqliteTable("proposed_slots", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  slotIndex: integer("slot_index").notNull(),
  startTime: integer("start_time").notNull(), // Unix timestamp UTC
  endTime: integer("end_time").notNull(),
  status: text("status", { enum: ["proposed", "confirmed", "rejected"] })
    .notNull()
    .default("proposed"),
});

export const slotResponses = sqliteTable("slot_responses", {
  id: text("id").primaryKey(),
  proposedSlotId: text("proposed_slot_id")
    .notNull()
    .references(() => proposedSlots.id),
  participantId: text("participant_id")
    .notNull()
    .references(() => participants.id),
  response: text("response", { enum: ["confirmed", "declined"] }).notNull(),
  respondedAt: integer("responded_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
export type ProposedSlot = typeof proposedSlots.$inferSelect;
export type NewProposedSlot = typeof proposedSlots.$inferInsert;
export type SlotResponse = typeof slotResponses.$inferSelect;
export type NewSlotResponse = typeof slotResponses.$inferInsert;
