import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import { emailDeliveries, type EmailKind, type Event, type ProposedSlot } from "./db/schema";
import { buildIcsEvent, icsAttachment } from "./ics";

let cachedClient: SESv2Client | null = null;
function ses(): SESv2Client {
  if (!cachedClient) {
    cachedClient = new SESv2Client({
      region: process.env.AWS_SES_REGION ?? "us-east-1",
    });
  }
  return cachedClient;
}

/**
 * A misconfigured sender silently torching deliverability is worse than a loud
 * failure, so there is no `noreply@example.com` fallback any more.
 */
export function senderAddress(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error(
      "EMAIL_FROM is not set. Configure a verified sending domain before sending mail."
    );
  }
  return from;
}

export function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    ""
  );
}

/**
 * Escapes text for interpolation into HTML.
 *
 * Every template below routes user-controlled values — titles, names,
 * descriptions, addresses — through this. Without it, a meeting titled
 * `<img onerror=…>` becomes markup in everyone's inbox.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes a value for safe use inside an `href`, rejecting non-HTTP schemes. */
export function escapeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "#";
    return escapeHtml(url.toString());
  } catch {
    return "#";
  }
}

/** Formats a slot as a sentence in the event's timezone. */
export function formatSlot(
  startMs: number,
  endMs: number,
  timezone: string
): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(startMs));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const zoneLabel =
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    })
      .formatToParts(new Date(startMs))
      .find((part) => part.type === "timeZoneName")?.value ?? timezone;

  return `${day} at ${time.format(new Date(startMs))} – ${time.format(
    new Date(endMs)
  )} (${zoneLabel})`;
}

// The warm identity from the web app, restated in email-safe inline styles.
const PALETTE = {
  bg: "#FAF6F0",
  surface: "#FFFFFF",
  primary: "#3D405B",
  accent: "#E07A5F",
  sage: "#81B29A",
  muted: "#9795A0",
  border: "#E8E2D9",
};

function layout(headline: string, body: string): string {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:${PALETTE.bg};font-family:'DM Sans',Helvetica,Arial,sans-serif;color:${PALETTE.primary};">
  <div style="max-width:520px;margin:0 auto;">
    <p style="font-size:20px;font-weight:700;margin:0 0 20px;color:${PALETTE.primary};">get2<span style="color:${PALETTE.accent};">gethr</span></p>
    <div style="background:${PALETTE.surface};border:1px solid ${PALETTE.border};border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${PALETTE.primary};">${headline}</h1>
      ${body}
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:${PALETTE.muted};">You received this because someone invited you to schedule a meeting.</p>
  </div>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${escapeUrl(href)}" style="display:inline-block;padding:12px 24px;background:${PALETTE.accent};color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;">${escapeHtml(label)}</a>`;
}

function highlight(text: string): string {
  return `<p style="font-size:17px;font-weight:700;padding:14px 16px;background:${PALETTE.bg};border:1px solid ${PALETTE.border};border-radius:12px;margin:0 0 20px;">${escapeHtml(text)}</p>`;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}

function cleanHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(cleanHeader(value), "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/** Builds the raw MIME message required for HTML, text, and ICS in one SES send. */
export function buildRawEmail(email: OutboundEmail, from = senderAddress()): Uint8Array {
  const mixedBoundary = `mixed-${uuidv4()}`;
  const alternativeBoundary = `alternative-${uuidv4()}`;
  const lines = [
    `From: ${cleanHeader(from)}`,
    `To: ${cleanHeader(email.to)}`,
    `Subject: ${encodeHeader(email.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${mixedBoundary}\"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary=\"${alternativeBoundary}\"`,
    "",
    `--${alternativeBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(email.text, "utf8").toString("base64")),
    `--${alternativeBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(email.html, "utf8").toString("base64")),
    `--${alternativeBoundary}--`,
  ];

  for (const attachment of email.attachments ?? []) {
    const filename = cleanHeader(attachment.filename).replace(/[\"]/g, "_");
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${cleanHeader(attachment.contentType)}; name=\"${filename}\"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename=\"${filename}\"`,
      "",
      wrapBase64(attachment.content)
    );
  }

  lines.push(`--${mixedBoundary}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

export interface SendOptions {
  eventId: string;
  participantId?: string | null;
  kind: EmailKind;
  /**
   * Stable across retries. The ledger's unique index turns a replayed job into
   * a no-op instead of a second copy in someone's inbox.
   */
  idempotencyKey: string;
}

export type SendResult =
  | { status: "sent"; messageId: string | null }
  | { status: "skipped"; reason: "already_sent" }
  | { status: "failed"; error: string; retryable: boolean };

/**
 * Sends one email and records the attempt.
 *
 * Failures are recorded rather than dropped — the previous implementation used
 * `Promise.allSettled` and discarded the results, so a bounce or an outage was
 * invisible and unresendable.
 */
export async function sendTrackedEmail(
  email: OutboundEmail,
  options: SendOptions
): Promise<SendResult> {
  const existing = await db.query.emailDeliveries.findFirst({
    where: eq(emailDeliveries.idempotencyKey, options.idempotencyKey),
  });
  if (existing?.status === "sent") {
    return { status: "skipped", reason: "already_sent" };
  }

  const now = Math.floor(Date.now() / 1000);
  const deliveryId = existing?.id ?? uuidv4();

  if (!existing) {
    try {
      await db.insert(emailDeliveries).values({
        id: deliveryId,
        eventId: options.eventId,
        participantId: options.participantId ?? null,
        kind: options.kind,
        toEmail: email.to,
        idempotencyKey: options.idempotencyKey,
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Another worker claimed this key first; treat it as already handled.
      return { status: "skipped", reason: "already_sent" };
    }
  }

  try {
    const response = await ses().send(
      new SendEmailCommand({
        FromEmailAddress: senderAddress(),
        Destination: { ToAddresses: [email.to] },
        Content: { Raw: { Data: buildRawEmail(email) } },
        ConfigurationSetName: process.env.AWS_SES_CONFIGURATION_SET || undefined,
        EmailTags: [{ Name: "kind", Value: options.kind }],
      })
    );

    await db
      .update(emailDeliveries)
      .set({
        status: "sent",
        providerMessageId: response.MessageId ?? null,
        error: null,
        attempts: (existing?.attempts ?? 0) + 1,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(emailDeliveries.id, deliveryId));

    return { status: "sent", messageId: response.MessageId ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const metadata =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number })
        : undefined;
    const status = metadata?.httpStatusCode;
    const name = error instanceof Error ? error.name : "";
    const retryable =
      status === 429 ||
      (status !== undefined && status >= 500) ||
      /throttl|timeout|serviceunavailable/i.test(`${name} ${message}`);

    await db
      .update(emailDeliveries)
      .set({
        status: "failed",
        error: message.slice(0, 500),
        attempts: (existing?.attempts ?? 0) + 1,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(emailDeliveries.id, deliveryId));

    return { status: "failed", error: message, retryable };
  }
}

// --- Templates -----------------------------------------------------------

export function inviteEmail(
  event: Pick<Event, "title" | "description" | "organizerName">,
  to: string,
  inviteToken: string
): OutboundEmail {
  const url = `${baseUrl()}/invite/${inviteToken}`;
  return {
    to,
    subject: `You're invited: ${event.title}`,
    html: layout(
      "You're invited to find a time",
      `<p style="margin:0 0 16px;line-height:1.6;"><strong>${escapeHtml(
        event.organizerName
      )}</strong> wants to find a time to meet for <strong>${escapeHtml(
        event.title
      )}</strong>.</p>
      ${
        event.description
          ? `<p style="margin:0 0 16px;line-height:1.6;color:${PALETTE.muted};">${escapeHtml(event.description)}</p>`
          : ""
      }
      <p style="margin:0 0 20px;line-height:1.6;">Connect your calendar so we can find a slot that works for everyone. We only read when you're busy — never what your meetings are.</p>
      ${button(url, "Connect calendar")}
      <p style="margin:20px 0 0;font-size:13px;color:${PALETTE.muted};">Not able to join? You can decline at the same link.</p>`
    ),
    text: `${event.organizerName} invited you to schedule "${event.title}".\n\nConnect your calendar: ${url}\n\nWe only read your busy times, never event details.`,
  };
}

export function proposalEmail(
  event: Pick<Event, "title" | "timezone">,
  slot: Pick<ProposedSlot, "startTime" | "endTime">,
  to: string,
  inviteToken: string
): OutboundEmail {
  const url = `${baseUrl()}/invite/${inviteToken}/confirm`;
  const slotText = formatSlot(slot.startTime * 1000, slot.endTime * 1000, event.timezone);
  return {
    to,
    subject: `Does this time work? ${event.title}`,
    html: layout(
      "We found a time everyone is free",
      `<p style="margin:0 0 16px;line-height:1.6;">For <strong>${escapeHtml(event.title)}</strong>:</p>
      ${highlight(slotText)}
      <p style="margin:0 0 20px;line-height:1.6;">Confirm and we'll put it on the calendar. Decline and we'll try the next best time.</p>
      ${button(url, "Confirm or decline")}`
    ),
    text: `A time was proposed for "${event.title}":\n\n${slotText}\n\nConfirm or decline: ${url}`,
  };
}

export function confirmationEmail(
  event: Pick<
    Event,
    "id" | "title" | "description" | "timezone" | "organizerEmail" | "organizerName"
  >,
  slot: Pick<ProposedSlot, "id" | "startTime" | "endTime">,
  to: string,
  attendees: Array<{ email: string; name?: string | null }>,
  options: { calendarWritten: boolean; timestampMs?: number } = {
    calendarWritten: false,
  }
): OutboundEmail {
  const startMs = slot.startTime * 1000;
  const endMs = slot.endTime * 1000;
  const slotText = formatSlot(startMs, endMs, event.timezone);

  const ics = buildIcsEvent({
    // Stable across resends, so a mail client updates the entry in place.
    uid: `${event.id}.${slot.id}@get2gethr`,
    title: event.title,
    description: event.description ?? undefined,
    startMs,
    endMs,
    organizer: { email: event.organizerEmail, name: event.organizerName },
    attendees: attendees.map((attendee) => ({
      email: attendee.email,
      name: attendee.name ?? undefined,
    })),
    timestampMs: options.timestampMs,
    url: `${baseUrl()}/events/${event.id}`,
  });

  const note = options.calendarWritten
    ? `<p style="margin:0 0 8px;line-height:1.6;color:${PALETTE.muted};">It's been added to the organizer's calendar and you should receive a calendar invitation too.</p>`
    : `<p style="margin:0 0 8px;line-height:1.6;color:${PALETTE.muted};">Add it to your calendar with the attached invitation.</p>`;

  return {
    to,
    subject: `Confirmed: ${event.title}`,
    html: layout(
      "Your meeting is confirmed",
      `<p style="margin:0 0 16px;line-height:1.6;"><strong>${escapeHtml(event.title)}</strong> is set for:</p>
      ${highlight(slotText)}
      ${note}`
    ),
    text: `"${event.title}" is confirmed for ${slotText}.\n\nA calendar invitation is attached.`,
    attachments: [icsAttachment(ics, "meeting.ics")],
  };
}

export function noSlotsEmail(
  event: Pick<Event, "title" | "organizerName" | "organizerEmail">,
  to: string
): OutboundEmail {
  return {
    to,
    subject: `No common time found: ${event.title}`,
    html: layout(
      "We couldn't find a time that works",
      `<p style="margin:0 0 16px;line-height:1.6;">There was no slot in the requested window where everyone was free for <strong>${escapeHtml(
        event.title
      )}</strong>.</p>
      <p style="margin:0;line-height:1.6;">Reach out to ${escapeHtml(
        event.organizerName
      )} at ${escapeHtml(event.organizerEmail)} to pick a time manually, or ask them to widen the date range.</p>`
    ),
    text: `No common time was found for "${event.title}". Contact ${event.organizerName} at ${event.organizerEmail} to coordinate manually.`,
  };
}

export function cancelledEmail(
  event: Pick<Event, "title" | "organizerName">,
  to: string
): OutboundEmail {
  return {
    to,
    subject: `Cancelled: ${event.title}`,
    html: layout(
      "This meeting was cancelled",
      `<p style="margin:0;line-height:1.6;">${escapeHtml(
        event.organizerName
      )} cancelled <strong>${escapeHtml(event.title)}</strong>. No further action is needed.</p>`
    ),
    text: `${event.organizerName} cancelled "${event.title}".`,
  };
}

export function reminderEmail(
  event: Pick<Event, "title" | "organizerName">,
  to: string,
  inviteToken: string,
  deadlineMs: number | null,
  timezone: string
): OutboundEmail {
  const url = `${baseUrl()}/invite/${inviteToken}`;
  const deadlineText = deadlineMs
    ? ` We need your answer by ${formatSlot(deadlineMs, deadlineMs + 60000, timezone).split(" – ")[0]}.`
    : "";
  return {
    to,
    subject: `Reminder: connect your calendar for ${event.title}`,
    html: layout(
      "Still waiting on you",
      `<p style="margin:0 0 20px;line-height:1.6;">${escapeHtml(
        event.organizerName
      )} is waiting to schedule <strong>${escapeHtml(event.title)}</strong>.${escapeHtml(
        deadlineText
      )}</p>
      ${button(url, "Connect calendar")}`
    ),
    text: `Reminder: ${event.organizerName} is waiting to schedule "${event.title}".${deadlineText}\n\n${url}`,
  };
}
