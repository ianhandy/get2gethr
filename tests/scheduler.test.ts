import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SES is stubbed before any app module imports it, so nothing leaves the
// machine and every send is inspectable.
const sentEmails: Array<{ to: string; subject: string; attachments?: unknown[] }> = [];
let emailFailure: string | null = null;

vi.mock("@aws-sdk/client-sesv2", () => ({
  SendEmailCommand: class {
    constructor(public input: {
      Destination: { ToAddresses: string[] };
      Content: { Raw: { Data: Uint8Array } };
    }) {}
  },
  SESv2Client: class {
    async send(command: {
      input: {
        Destination: { ToAddresses: string[] };
        Content: { Raw: { Data: Uint8Array } };
      };
    }) {
      if (emailFailure) throw new Error(emailFailure);
      const raw = Buffer.from(command.input.Content.Raw.Data).toString("utf8");
      const encodedSubject = raw.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)?.[1];
      sentEmails.push({
        to: command.input.Destination.ToAddresses[0],
        subject: encodedSubject
          ? Buffer.from(encodedSubject, "base64").toString("utf8")
          : "",
        attachments: raw.match(/^Content-Disposition: attachment;/gm) ?? [],
      });
      return { MessageId: `msg-${sentEmails.length}` };
    }
  },
}));

import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import {
  calendarConnections,
  events,
  participants,
  proposedSlots,
  slotResponses,
  type Participant,
} from "@/lib/db/schema";
import { __setBrokerForTesting, FakeCalendarBroker } from "@/lib/calendar";
import type { Interval } from "@/lib/availability";
import {
  advanceEvent,
  finalizeSlotIfReady,
  forceConfirmCurrentSlot,
  cancelEvent,
  remindNonresponders,
  retryCalendarWrite,
} from "@/lib/scheduler";
import { zonedWallClockToUtcMs } from "@/lib/time";
import { resetDatabase, seedEvent, setupSchema } from "./helpers/db";

const NY = "America/New_York";
let broker: FakeCalendarBroker;

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  // These scenarios use a fixed August 2026 scheduling window. Pin "now" so
  // the suite remains deterministic after that date instead of silently
  // treating every candidate as historical.
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T12:00:00Z"));
  await resetDatabase();
  sentEmails.length = 0;
  emailFailure = null;
  broker = new FakeCalendarBroker();
  __setBrokerForTesting("fake", broker);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function at(date: string, time: string, tz = NY): number {
  const [h, m] = time.split(":").map(Number);
  return zonedWallClockToUtcMs(date, h * 60 + m, tz);
}

/** Connects a participant's calendar, as the OAuth callback would. */
async function connect(
  participant: Participant,
  options: { busy?: Interval[]; destination?: string | null } = {}
): Promise<void> {
  broker.registerAccount(`code-${participant.email}`, { email: participant.email });
  broker.setBusy(participant.email, options.busy ?? []);

  await db.insert(calendarConnections).values({
    id: uuidv4(),
    participantId: participant.id,
    provider: "google",
    broker: "fake",
    accountEmail: participant.email,
    sourceCalendarIds: JSON.stringify([`${participant.email}:primary`]),
    destinationCalendarId:
      options.destination === undefined
        ? `${participant.email}:primary`
        : options.destination,
    status: "connected",
  });

  await db
    .update(participants)
    .set({ status: "joined", joinedAt: Math.floor(Date.now() / 1000) })
    .where(eq(participants.id, participant.id));
}

async function decline(participant: Participant): Promise<void> {
  await db
    .update(participants)
    .set({ status: "declined" })
    .where(eq(participants.id, participant.id));
}

async function eventStatus(eventId: string) {
  const row = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  return row!;
}

async function currentSlot(eventId: string) {
  return db.query.proposedSlots.findFirst({
    where: and(eq(proposedSlots.eventId, eventId), eq(proposedSlots.status, "proposed")),
  });
}

async function respond(
  slotId: string,
  participant: Participant,
  response: "confirmed" | "declined"
): Promise<void> {
  await db.insert(slotResponses).values({
    id: uuidv4(),
    proposedSlotId: slotId,
    participantId: participant.id,
    response,
  });
}

/** Seeds an event where everyone has connected and nobody is busy. */
async function readyEvent(overrides = {}) {
  const seeded = await seedEvent({ status: "gathering", ...overrides });
  await connect(seeded.organizer);
  for (const attendee of seeded.attendees) await connect(attendee);
  return seeded;
}

describe("advanceEvent — gathering", () => {
  it("waits while someone has not answered", async () => {
    const seeded = await seedEvent({ status: "gathering" });
    await connect(seeded.organizer);
    await connect(seeded.attendees[0]);

    await advanceEvent(seeded.event.id);

    expect((await eventStatus(seeded.event.id)).status).toBe("gathering");
    expect(await currentSlot(seeded.event.id)).toBeUndefined();
  });

  it("proposes once everyone has answered", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);

    expect((await eventStatus(seeded.event.id)).status).toBe("proposing");
    const slot = await currentSlot(seeded.event.id);
    expect(slot).toBeDefined();
    expect(slot!.rank).toBe(0);
  });

  it("fails cleanly when everyone declines instead of stalling forever", async () => {
    const seeded = await seedEvent({ status: "gathering" });
    await connect(seeded.organizer);
    for (const attendee of seeded.attendees) await decline(attendee);

    await advanceEvent(seeded.event.id);

    // The organizer alone still counts as a contributor, so this proposes.
    expect((await eventStatus(seeded.event.id)).status).toBe("proposing");
  });

  it("fails when nobody at all has a connected calendar", async () => {
    const seeded = await seedEvent({ status: "gathering" });
    await decline(seeded.attendees[0]);
    await decline(seeded.attendees[1]);
    await db
      .update(participants)
      .set({ status: "declined" })
      .where(eq(participants.id, seeded.organizer.id));

    await advanceEvent(seeded.event.id);

    expect((await eventStatus(seeded.event.id)).status).toBe("failed");
    expect(sentEmails.some((email) => email.subject.includes("No common time"))).toBe(
      true
    );
  });

  it("fails when no slot works for everyone", async () => {
    const seeded = await seedEvent({
      status: "gathering",
      startDate: "2026-08-31",
      endDate: "2026-08-31",
    });
    const allWeek: Interval[] = [
      [at("2026-08-31", "00:00"), at("2026-09-05", "00:00")],
    ];
    await connect(seeded.organizer, { busy: allWeek });
    for (const attendee of seeded.attendees) await connect(attendee);

    await advanceEvent(seeded.event.id);

    expect((await eventStatus(seeded.event.id)).status).toBe("failed");
  });

  it("excludes time the organizer is busy, not only invitees", async () => {
    const seeded = await seedEvent({
      status: "gathering",
      startDate: "2026-08-31",
      endDate: "2026-08-31",
    });
    // The organizer is booked all morning; nobody else is busy at all.
    await connect(seeded.organizer, {
      busy: [[at("2026-08-31", "09:00"), at("2026-08-31", "15:00")]],
    });
    for (const attendee of seeded.attendees) await connect(attendee);

    await advanceEvent(seeded.event.id);

    const slot = await currentSlot(seeded.event.id);
    expect(slot).toBeDefined();
    expect(slot!.startTime * 1000).toBeGreaterThanOrEqual(at("2026-08-31", "15:00"));
  });

  it("is idempotent when called repeatedly", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    await advanceEvent(seeded.event.id);
    await advanceEvent(seeded.event.id);

    const proposed = await db.query.proposedSlots.findMany({
      where: and(
        eq(proposedSlots.eventId, seeded.event.id),
        eq(proposedSlots.status, "proposed")
      ),
    });
    expect(proposed).toHaveLength(1);
  });

  it("stops at action_required when a calendar grant has been revoked", async () => {
    const seeded = await readyEvent();
    broker.authorizationRevoked = true;

    await advanceEvent(seeded.event.id);

    const event = await eventStatus(seeded.event.id);
    expect(event.status).toBe("action_required");
    // Crucially not "failed": a lost grant is a fixable problem, and treating
    // it as "no times work" would have been a lie.
    expect(event.calendarWriteError).toMatch(/reconnected/i);
  });

  it("stops at action_required during a provider outage", async () => {
    const seeded = await readyEvent();
    broker.failNextCalls = 99;

    await advanceEvent(seeded.event.id);

    expect((await eventStatus(seeded.event.id)).status).toBe("action_required");
  });

  it("never proposes a time in the past", async () => {
    const seeded = await readyEvent({
      startDate: "2020-01-06",
      endDate: "2020-01-10",
    });
    await advanceEvent(seeded.event.id);
    expect((await eventStatus(seeded.event.id)).status).toBe("failed");
  });
});

describe("nonresponder policy", () => {
  it("holds the event when the policy is to wait", async () => {
    const seeded = await seedEvent({
      status: "gathering",
      responseDeadline: Math.floor(Date.now() / 1000) - 60,
      nonresponderPolicy: "wait",
    });
    await connect(seeded.organizer);
    await connect(seeded.attendees[0]);

    await advanceEvent(seeded.event.id);

    expect((await eventStatus(seeded.event.id)).status).toBe("gathering");
  });

  it("proceeds without the holdout once the deadline passes", async () => {
    const seeded = await seedEvent({
      status: "gathering",
      responseDeadline: Math.floor(Date.now() / 1000) - 60,
      nonresponderPolicy: "proceed_without",
    });
    await connect(seeded.organizer);
    await connect(seeded.attendees[0]);

    await advanceEvent(seeded.event.id);

    expect((await eventStatus(seeded.event.id)).status).toBe("proposing");
    const holdout = await db.query.participants.findFirst({
      where: eq(participants.id, seeded.attendees[1].id),
    });
    expect(holdout!.status).toBe("removed");
  });

  it("sends at most one reminder per person per day", async () => {
    const seeded = await seedEvent({ status: "gathering" });
    await connect(seeded.organizer);

    expect(await remindNonresponders(seeded.event.id)).toBe(2);
    expect(await remindNonresponders(seeded.event.id)).toBe(0);
  });
});

describe("slot responses", () => {
  it("proposes the next slot when someone declines", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);

    const first = (await currentSlot(seeded.event.id))!;
    await respond(first.id, seeded.organizer, "confirmed");
    await respond(first.id, seeded.attendees[0], "declined");
    await respond(first.id, seeded.attendees[1], "confirmed");
    await finalizeSlotIfReady(first.id);

    const second = (await currentSlot(seeded.event.id))!;
    expect(second.id).not.toBe(first.id);
    expect(second.rank).toBeGreaterThan(first.rank);

    const rejected = await db.query.proposedSlots.findFirst({
      where: eq(proposedSlots.id, first.id),
    });
    expect(rejected!.status).toBe("rejected");
  });

  it("waits until everyone has answered", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);

    const slot = (await currentSlot(seeded.event.id))!;
    await respond(slot.id, seeded.organizer, "confirmed");
    await finalizeSlotIfReady(slot.id);

    const unchanged = await db.query.proposedSlots.findFirst({
      where: eq(proposedSlots.id, slot.id),
    });
    expect(unchanged!.status).toBe("proposed");
  });

  it("rejects a second response from the same person", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    const slot = (await currentSlot(seeded.event.id))!;

    await respond(slot.id, seeded.attendees[0], "confirmed");
    await expect(respond(slot.id, seeded.attendees[0], "declined")).rejects.toThrow();
  });

  it("fails the event when every slot has been rejected", async () => {
    // A single working day with a 6-hour meeting leaves few candidates.
    const seeded = await readyEvent({
      startDate: "2026-08-31",
      endDate: "2026-08-31",
      durationMinutes: 420,
    });
    await advanceEvent(seeded.event.id);

    for (let round = 0; round < 10; round++) {
      const slot = await currentSlot(seeded.event.id);
      if (!slot) break;
      await respond(slot.id, seeded.organizer, "declined");
      await respond(slot.id, seeded.attendees[0], "confirmed");
      await respond(slot.id, seeded.attendees[1], "confirmed");
      await finalizeSlotIfReady(slot.id);
    }

    expect((await eventStatus(seeded.event.id)).status).toBe("failed");
  });
});

describe("confirmation and calendar write", () => {
  async function confirmEverything(seeded: Awaited<ReturnType<typeof readyEvent>>) {
    const slot = (await currentSlot(seeded.event.id))!;
    await respond(slot.id, seeded.organizer, "confirmed");
    for (const attendee of seeded.attendees) {
      await respond(slot.id, attendee, "confirmed");
    }
    await finalizeSlotIfReady(slot.id);
    return slot;
  }

  it("writes the meeting to the organizer's calendar exactly once", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    await confirmEverything(seeded);

    expect(broker.createdEvents.size).toBe(1);
    const event = await eventStatus(seeded.event.id);
    expect(event.status).toBe("confirmed");
    expect(event.calendarWriteStatus).toBe("written");
    expect(event.externalEventId).toBeTruthy();
  });

  it("writes to the organizer's calendar, not an attendee's", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    await confirmEverything(seeded);

    const [request] = [...broker.createdEvents.values()];
    expect(request.calendarId).toBe(`${seeded.organizer.email}:primary`);
    expect(request.organizer.email).toBe(seeded.organizer.email);
  });

  it("invites every joined participant as an attendee", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    await confirmEverything(seeded);

    const [request] = [...broker.createdEvents.values()];
    const emails = request.attendees.map((attendee) => attendee.email).sort();
    expect(emails).toEqual(
      [seeded.organizer.email, ...seeded.attendees.map((a) => a.email)].sort()
    );
  });

  it("does not create a second meeting when finalization is replayed", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    const slot = await confirmEverything(seeded);

    await finalizeSlotIfReady(slot.id);
    await finalizeSlotIfReady(slot.id);

    expect(broker.createdEvents.size).toBe(1);
  });

  it("uses an idempotency key stable across retries", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    await confirmEverything(seeded);
    const firstKey = broker.createEventCalls[0].idempotencyKey;

    await retryCalendarWrite(seeded.event.id);

    for (const call of broker.createEventCalls) {
      expect(call.idempotencyKey).toBe(firstKey);
    }
    expect(broker.createdEvents.size).toBe(1);
  });

  it("sends everyone a confirmation with an ICS attachment", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    await confirmEverything(seeded);

    const confirmations = sentEmails.filter((email) =>
      email.subject.startsWith("Confirmed:")
    );
    expect(confirmations).toHaveLength(3);
    for (const email of confirmations) {
      expect(email.attachments).toHaveLength(1);
    }
  });

  it("does not say confirmed when the calendar write failed", async () => {
    const seeded = await seedEvent({ status: "gathering" });
    // The organizer has no writable destination calendar.
    await connect(seeded.organizer, { destination: null });
    for (const attendee of seeded.attendees) await connect(attendee);

    await advanceEvent(seeded.event.id);
    await confirmEverything(seeded as never);

    const event = await eventStatus(seeded.event.id);
    expect(event.status).toBe("action_required");
    expect(event.calendarWriteStatus).toBe("failed");
    // People are still told the time, with the ICS fallback.
    expect(
      sentEmails.filter((email) => email.subject.startsWith("Confirmed:")).length
    ).toBeGreaterThan(0);
  });

  it("recovers when a retried calendar write succeeds", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);

    broker.failNextCalls = 0;
    const slot = (await currentSlot(seeded.event.id))!;
    await respond(slot.id, seeded.organizer, "confirmed");
    for (const attendee of seeded.attendees) await respond(slot.id, attendee, "confirmed");

    // Fail the free/busy recheck and the write, then let the retry go through.
    broker.failNextCalls = 99;
    await finalizeSlotIfReady(slot.id);
    expect((await eventStatus(seeded.event.id)).calendarWriteStatus).toBe("failed");

    broker.failNextCalls = 0;
    await retryCalendarWrite(seeded.event.id);

    const event = await eventStatus(seeded.event.id);
    expect(event.status).toBe("confirmed");
    expect(event.calendarWriteStatus).toBe("written");
  });

  it("re-proposes when the agreed time is taken before it is booked", async () => {
    const seeded = await readyEvent({
      startDate: "2026-08-31",
      endDate: "2026-08-31",
    });
    await advanceEvent(seeded.event.id);
    const slot = (await currentSlot(seeded.event.id))!;

    await respond(slot.id, seeded.organizer, "confirmed");
    for (const attendee of seeded.attendees) await respond(slot.id, attendee, "confirmed");

    // Someone books over the agreed slot in the moment before the write.
    broker.setBusy(seeded.attendees[0].email, [
      [slot.startTime * 1000, slot.endTime * 1000],
    ]);

    await finalizeSlotIfReady(slot.id);

    const event = await eventStatus(seeded.event.id);
    expect(event.status).toBe("proposing");
    expect(broker.createdEvents.size).toBe(0);

    const replacement = await currentSlot(seeded.event.id);
    expect(replacement!.id).not.toBe(slot.id);
  });
});

describe("organizer overrides", () => {
  it("confirms the current slot without waiting for everyone", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);

    expect(await forceConfirmCurrentSlot(seeded.event.id)).toBe(true);
    expect((await eventStatus(seeded.event.id)).status).toBe("confirmed");
    expect(broker.createdEvents.size).toBe(1);
  });

  it("reports failure when nothing is proposed", async () => {
    const seeded = await seedEvent({ status: "gathering" });
    expect(await forceConfirmCurrentSlot(seeded.event.id)).toBe(false);
  });

  it("cancels an event at any stage", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);

    expect(await cancelEvent(seeded.event.id)).toBe(true);
    expect((await eventStatus(seeded.event.id)).status).toBe("cancelled");
    // A cancelled event cannot be cancelled again.
    expect(await cancelEvent(seeded.event.id)).toBe(false);
  });

  it("does not advance a cancelled event", async () => {
    const seeded = await readyEvent();
    await cancelEvent(seeded.event.id);
    await advanceEvent(seeded.event.id);
    expect((await eventStatus(seeded.event.id)).status).toBe("cancelled");
  });
});

describe("email delivery ledger", () => {
  it("records a failure rather than discarding it", async () => {
    const seeded = await seedEvent({ status: "gathering" });
    await connect(seeded.organizer);
    emailFailure = "mailbox unavailable";

    await remindNonresponders(seeded.event.id);

    const deliveries = await db.query.emailDeliveries.findMany({});
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every((delivery) => delivery.status === "failed")).toBe(true);
    expect(deliveries[0].error).toContain("mailbox unavailable");
  });

  it("does not send the same proposal twice", async () => {
    const seeded = await readyEvent();
    await advanceEvent(seeded.event.id);
    const before = sentEmails.length;

    await advanceEvent(seeded.event.id);

    expect(sentEmails.length).toBe(before);
  });
});
