import { v4 as uuidv4 } from "uuid";
import { client, db } from "@/lib/db";
import { migrate } from "@/lib/db/migrations";
import {
  events,
  participants,
  type Event,
  type Participant,
} from "@/lib/db/schema";
import { generateToken } from "@/lib/crypto";
import { localDateRangeToUtcBounds } from "@/lib/time";

/** Creates the schema on the app's in-memory test database. */
export async function setupSchema(): Promise<void> {
  await migrate(client);
}

const TABLES = [
  "slot_responses",
  "proposed_slots",
  "email_deliveries",
  "oauth_states",
  "calendar_connections",
  "participants",
  "events",
  "rate_limit_buckets",
];

/** Empties every table so each test starts from a known state. */
export async function resetDatabase(): Promise<void> {
  for (const table of TABLES) {
    await client.execute(`DELETE FROM ${table}`);
  }
}

export interface SeedEventOptions {
  title?: string;
  organizerEmail?: string;
  organizerName?: string;
  startDate?: string;
  endDate?: string;
  timezone?: string;
  durationMinutes?: number;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  excludeWeekends?: boolean;
  status?: Event["status"];
  attendeeEmails?: string[];
  responseDeadline?: number | null;
  nonresponderPolicy?: Event["nonresponderPolicy"];
}

export interface SeededEvent {
  event: Event;
  organizer: Participant;
  attendees: Participant[];
  organizerToken: string;
}

/** Creates an event with an organizer row and attendee rows, as the API does. */
export async function seedEvent(
  options: SeedEventOptions = {}
): Promise<SeededEvent> {
  const {
    title = "Weekly Sync",
    organizerEmail = "jane@example.com",
    organizerName = "Jane Smith",
    startDate = "2026-08-31",
    endDate = "2026-09-04",
    timezone = "America/New_York",
    durationMinutes = 60,
    workingHoursStart = "09:00",
    workingHoursEnd = "17:00",
    excludeWeekends = true,
    status = "draft",
    attendeeEmails = ["alex@example.com", "sam@example.com"],
    responseDeadline = null,
    nonresponderPolicy = "wait",
  } = options;

  const eventId = uuidv4();
  const organizerToken = generateToken();
  const { startMs, endMs } = localDateRangeToUtcBounds(startDate, endDate, timezone);

  await db.insert(events).values({
    id: eventId,
    title,
    description: null,
    organizerEmail,
    organizerName,
    organizerToken,
    startDate,
    endDate,
    dateRangeStart: Math.floor(startMs / 1000),
    dateRangeEnd: Math.floor(endMs / 1000),
    durationMinutes,
    workingHoursStart,
    workingHoursEnd,
    timezone,
    excludeWeekends,
    status,
    responseDeadline,
    nonresponderPolicy,
  });

  const organizerRow = {
    id: uuidv4(),
    eventId,
    email: organizerEmail,
    name: organizerName,
    role: "organizer" as const,
    inviteToken: generateToken(),
    status: "pending" as const,
  };
  const attendeeRows = attendeeEmails.map((email) => ({
    id: uuidv4(),
    eventId,
    email,
    role: "attendee" as const,
    inviteToken: generateToken(),
    status: "pending" as const,
  }));

  await db.insert(participants).values([organizerRow, ...attendeeRows]);

  const stored = await db.query.events.findFirst({
    where: (table, { eq }) => eq(table.id, eventId),
  });
  const storedParticipants = await db.query.participants.findMany({
    where: (table, { eq }) => eq(table.eventId, eventId),
  });

  return {
    event: stored!,
    organizer: storedParticipants.find((p) => p.role === "organizer")!,
    attendees: storedParticipants.filter((p) => p.role === "attendee"),
    organizerToken,
  };
}
