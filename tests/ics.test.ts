import { describe, expect, it } from "vitest";
import {
  buildIcsEvent,
  escapeIcsText,
  foldIcsLine,
  formatIcsUtc,
  icsAttachment,
  type IcsEventInput,
} from "@/lib/ics";

/** Reverses RFC 5545 line folding, so assertions read whole content lines. */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

function baseEvent(overrides: Partial<IcsEventInput> = {}): IcsEventInput {
  return {
    uid: "event-123@get2gethr",
    title: "Weekly Sync",
    startMs: Date.UTC(2026, 7, 31, 13, 0),
    endMs: Date.UTC(2026, 7, 31, 14, 0),
    organizer: { email: "jane@example.com", name: "Jane Smith" },
    attendees: [{ email: "alex@example.com", name: "Alex" }],
    timestampMs: Date.UTC(2026, 7, 30, 12, 0),
    ...overrides,
  };
}

describe("escapeIcsText", () => {
  it("escapes the characters RFC 5545 reserves", () => {
    expect(escapeIcsText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
  });

  it("turns newlines into literal \\n", () => {
    expect(escapeIcsText("line one\nline two")).toBe("line one\\nline two");
    expect(escapeIcsText("crlf\r\nhere")).toBe("crlf\\nhere");
  });

  it("escapes backslashes before other characters, not after", () => {
    expect(escapeIcsText("\\;")).toBe("\\\\\\;");
  });
});

describe("formatIcsUtc", () => {
  it("uses UTC basic format", () => {
    expect(formatIcsUtc(Date.UTC(2026, 7, 31, 13, 5, 9))).toBe("20260831T130509Z");
  });
});

describe("foldIcsLine", () => {
  it("leaves short lines alone", () => {
    expect(foldIcsLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds long lines with a leading space on continuations", () => {
    const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
    const segments = folded.split("\r\n");
    expect(segments.length).toBeGreaterThan(1);
    expect(Buffer.byteLength(segments[0])).toBeLessThanOrEqual(75);
    for (const segment of segments.slice(1)) {
      expect(segment.startsWith(" ")).toBe(true);
      expect(Buffer.byteLength(segment)).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"x".repeat(200)}`);
  });

  it("never splits a multi-byte character across a fold", () => {
    const folded = foldIcsLine(`SUMMARY:${"日".repeat(60)}`);
    expect(folded).not.toContain("�");
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"日".repeat(60)}`);
  });
});

describe("buildIcsEvent", () => {
  it("emits a well-formed calendar", () => {
    const ics = buildIcsEvent(baseEvent());
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });

  it("uses CRLF line endings throughout", () => {
    const ics = buildIcsEvent(baseEvent());
    expect(ics.split("\n").every((line) => line === "" || line.endsWith("\r"))).toBe(
      true
    );
  });

  it("carries the stable UID so a resend updates rather than duplicates", () => {
    expect(buildIcsEvent(baseEvent())).toContain("UID:event-123@get2gethr");
  });

  it("writes start and end in UTC", () => {
    const ics = buildIcsEvent(baseEvent());
    expect(ics).toContain("DTSTART:20260831T130000Z");
    expect(ics).toContain("DTEND:20260831T140000Z");
    expect(ics).toContain("DTSTAMP:20260830T120000Z");
  });

  it("lists the organizer and every attendee", () => {
    const ics = unfold(
      buildIcsEvent(
        baseEvent({
          attendees: [
            { email: "alex@example.com", name: "Alex" },
            { email: "sam@example.com" },
          ],
        })
      )
    );
    expect(ics).toContain("ORGANIZER;CN=Jane Smith:mailto:jane@example.com");
    expect(ics).toContain("ATTENDEE;CN=Alex");
    expect(ics).toContain("mailto:alex@example.com");
    expect(ics).toContain("mailto:sam@example.com");
  });

  it("marks attendees as needing a response", () => {
    expect(unfold(buildIcsEvent(baseEvent()))).toContain(
      "PARTSTAT=NEEDS-ACTION;RSVP=TRUE"
    );
  });

  it("escapes user-supplied text rather than letting it break the format", () => {
    const ics = unfold(
      buildIcsEvent(
        baseEvent({
          title: "Budget; Q4, final",
          description: "Line one\nLine two",
        })
      )
    );
    expect(ics).toContain("SUMMARY:Budget\\; Q4\\, final");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    // The injected newline must not have created a new content line.
    expect(ics).not.toContain("\r\nLine two");
  });

  it("cannot be used to inject a second event", () => {
    const ics = unfold(
      buildIcsEvent(
        baseEvent({ title: "Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Injected" })
      )
    );
    // The payload survives as escaped text inside SUMMARY, but never as a
    // content line of its own — that distinction is the whole defence.
    const lines = ics.split("\r\n");
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((line) => line === "END:VEVENT")).toHaveLength(1);
    expect(lines.some((line) => line === "SUMMARY:Injected")).toBe(false);
  });

  it("omits an absent description", () => {
    expect(buildIcsEvent(baseEvent())).not.toContain("DESCRIPTION:");
  });

  it("supports cancellation", () => {
    const ics = buildIcsEvent(baseEvent({ status: "CANCELLED", sequence: 1 }));
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:1");
  });

  it("rejects a non-positive duration", () => {
    expect(() =>
      buildIcsEvent(baseEvent({ endMs: Date.UTC(2026, 7, 31, 13, 0) }))
    ).toThrow();
  });

  it("is byte-identical across repeated builds", () => {
    expect(buildIcsEvent(baseEvent())).toBe(buildIcsEvent(baseEvent()));
  });
});

describe("icsAttachment", () => {
  it("base64-encodes the calendar with a calendar content type", () => {
    const ics = buildIcsEvent(baseEvent());
    const attachment = icsAttachment(ics, "meeting.ics");
    expect(attachment.filename).toBe("meeting.ics");
    expect(attachment.contentType).toContain("text/calendar");
    expect(Buffer.from(attachment.content, "base64").toString("utf8")).toBe(ics);
  });
});
