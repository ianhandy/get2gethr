/**
 * Minimal RFC 5545 calendar generation.
 *
 * The ICS attachment is the fallback that makes a confirmation useful even when
 * the calendar write failed or the attendee's provider is one we cannot write
 * to. Every mainstream mail client turns it into a real calendar entry.
 */

export interface IcsAttendee {
  email: string;
  name?: string;
}

export interface IcsEventInput {
  /** Globally unique and stable — a resend must not create a second entry. */
  uid: string;
  title: string;
  description?: string;
  startMs: number;
  endMs: number;
  organizer: IcsAttendee;
  attendees: IcsAttendee[];
  /** Bumped when an already-sent invitation is revised. */
  sequence?: number;
  status?: "CONFIRMED" | "CANCELLED";
  /** Overrides "now" so output is reproducible in tests. */
  timestampMs?: number;
  url?: string;
}

/** Escapes the characters RFC 5545 gives special meaning inside a value. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** UTC basic format: `20260831T130000Z`. */
export function formatIcsUtc(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(
    11,
    13
  )}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/**
 * Folds a content line to 75 octets, continuing with a leading space.
 *
 * The limit is octets, not characters, so a multi-byte character must not be
 * split across the fold.
 */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let cursor = 0;
  let limit = 75;
  while (cursor < bytes.length) {
    let take = Math.min(limit, bytes.length - cursor);
    // Back off until the slice ends on a character boundary.
    while (take > 0) {
      const slice = bytes.subarray(cursor, cursor + take);
      const decoded = slice.toString("utf8");
      if (!decoded.includes("�")) break;
      take -= 1;
    }
    parts.push(bytes.subarray(cursor, cursor + take).toString("utf8"));
    cursor += take;
    limit = 74; // continuation lines carry a leading space
  }
  return parts.join("\r\n ");
}

function attendeeLine(prefix: string, attendee: IcsAttendee, extra = ""): string {
  const name = attendee.name ? `;CN=${escapeIcsText(attendee.name)}` : "";
  return `${prefix}${name}${extra}:mailto:${attendee.email}`;
}

/**
 * Builds a `METHOD:REQUEST` calendar containing one event.
 *
 * Output uses CRLF line endings, as the spec requires; mail clients are
 * noticeably less forgiving about this than about most of RFC 5545.
 */
export function buildIcsEvent(input: IcsEventInput): string {
  const {
    uid,
    title,
    description,
    startMs,
    endMs,
    organizer,
    attendees,
    sequence = 0,
    status = "CONFIRMED",
    timestampMs = Date.now(),
    url,
  } = input;

  if (endMs <= startMs) {
    throw new Error("ICS event must end after it starts");
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//get2gethr//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    status === "CANCELLED" ? "METHOD:CANCEL" : "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${formatIcsUtc(timestampMs)}`,
    `DTSTART:${formatIcsUtc(startMs)}`,
    `DTEND:${formatIcsUtc(endMs)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
    ...(url ? [`URL:${escapeIcsText(url)}`] : []),
    attendeeLine("ORGANIZER", organizer),
    ...attendees.map((attendee) =>
      attendeeLine(
        "ATTENDEE",
        attendee,
        ";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE"
      )
    ),
    `SEQUENCE:${sequence}`,
    `STATUS:${status}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Base64 payload for attaching the calendar to an outbound email. */
export function icsAttachment(
  ics: string,
  filename = "invite.ics"
): { filename: string; content: string; contentType: string } {
  return {
    filename,
    content: Buffer.from(ics, "utf8").toString("base64"),
    contentType: "text/calendar; method=REQUEST; charset=UTF-8",
  };
}
