import { describe, expect, it } from "vitest";
import {
  confirmationEmail,
  escapeHtml,
  escapeUrl,
  formatSlot,
  inviteEmail,
  noSlotsEmail,
  proposalEmail,
} from "@/lib/email";

const EVENT = {
  id: "event-1",
  title: "Weekly Sync",
  description: "Planning for Q4",
  timezone: "America/New_York",
  organizerEmail: "jane@example.com",
  organizerName: "Jane Smith",
};

const SLOT = {
  id: "slot-1",
  startTime: Math.floor(Date.UTC(2026, 7, 31, 13, 0) / 1000),
  endTime: Math.floor(Date.UTC(2026, 7, 31, 14, 0) / 1000),
};

describe("escapeHtml", () => {
  it("escapes every character that can start markup", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });

  it("escapes ampersands before other entities, avoiding double-encoding bugs", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Weekly Sync")).toBe("Weekly Sync");
  });
});

describe("escapeUrl", () => {
  it("passes through http and https", () => {
    expect(escapeUrl("https://get2gethr.app/invite/abc")).toBe(
      "https://get2gethr.app/invite/abc"
    );
  });

  it("refuses javascript and data URLs", () => {
    expect(escapeUrl("javascript:alert(1)")).toBe("#");
    expect(escapeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("refuses malformed URLs", () => {
    expect(escapeUrl("not a url")).toBe("#");
  });
});

describe("formatSlot", () => {
  it("renders the time in the event timezone, not UTC", () => {
    const text = formatSlot(
      Date.UTC(2026, 7, 31, 13, 0),
      Date.UTC(2026, 7, 31, 14, 0),
      "America/New_York"
    );
    expect(text).toContain("Monday, August 31, 2026");
    expect(text).toContain("9:00 AM");
    expect(text).toContain("10:00 AM");
  });

  it("names the zone so a reader can check it", () => {
    expect(
      formatSlot(Date.UTC(2026, 7, 31, 13, 0), Date.UTC(2026, 7, 31, 14, 0), "Asia/Tokyo")
    ).toMatch(/\(GMT\+9|JST/);
  });
});

describe("template escaping", () => {
  const hostile = {
    ...EVENT,
    title: `<script>alert("xss")</script>`,
    description: `<img src=x onerror="steal()">`,
    organizerName: `Mallory <b>Evil</b>`,
  };

  it("escapes a hostile title in the invite email", () => {
    const email = inviteEmail(hostile, "alex@example.com", "tok");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("escapes a hostile description", () => {
    const email = inviteEmail(hostile, "alex@example.com", "tok");
    // The payload survives as inert text, fully entity-encoded; what must not
    // appear anywhere is the raw tag a browser would act on.
    expect(email.html).not.toContain(`<img src=x onerror="steal()">`);
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;steal()&quot;&gt;");
  });

  it("escapes a hostile organizer name", () => {
    const email = inviteEmail(hostile, "alex@example.com", "tok");
    expect(email.html).not.toContain("Mallory <b>");
    expect(email.html).toContain("Mallory &lt;b&gt;");
  });

  it("escapes hostile content in the proposal email", () => {
    const email = proposalEmail(hostile, SLOT, "alex@example.com", "tok");
    expect(email.html).not.toContain("<script>");
  });

  it("escapes hostile content in the confirmation email", () => {
    const email = confirmationEmail(hostile, SLOT, "alex@example.com", []);
    expect(email.html).not.toContain("<script>");
  });

  it("escapes the organizer address in the no-slots email", () => {
    const email = noSlotsEmail(
      { ...hostile, organizerEmail: `x@y.com"><script>alert(1)</script>` },
      "alex@example.com"
    );
    expect(email.html).not.toContain("<script>alert(1)</script>");
  });
});

describe("inviteEmail", () => {
  it("links to the invite page for the given token", () => {
    const email = inviteEmail(EVENT, "alex@example.com", "tok-123");
    expect(email.html).toContain("/invite/tok-123");
    expect(email.text).toContain("/invite/tok-123");
  });

  it("has both an HTML and a plain-text body", () => {
    const email = inviteEmail(EVENT, "alex@example.com", "tok");
    expect(email.html.length).toBeGreaterThan(0);
    expect(email.text.length).toBeGreaterThan(0);
  });

  it("says what data is read, so consent is informed", () => {
    expect(inviteEmail(EVENT, "alex@example.com", "tok").text).toMatch(
      /busy times, never event details/i
    );
  });
});

describe("proposalEmail", () => {
  it("states the proposed time in the event timezone", () => {
    const email = proposalEmail(EVENT, SLOT, "alex@example.com", "tok");
    expect(email.html).toContain("9:00 AM");
    expect(email.subject).toContain("Weekly Sync");
  });

  it("links to the confirm page", () => {
    expect(proposalEmail(EVENT, SLOT, "alex@example.com", "tok").html).toContain(
      "/invite/tok/confirm"
    );
  });
});

describe("confirmationEmail", () => {
  const attendees = [
    { email: "alex@example.com", name: "Alex" },
    { email: "sam@example.com", name: null },
  ];

  it("attaches an ICS calendar", () => {
    const email = confirmationEmail(EVENT, SLOT, "alex@example.com", attendees);
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments![0].filename).toBe("meeting.ics");
    expect(email.attachments![0].contentType).toContain("text/calendar");
  });

  it("builds an ICS carrying the event and every attendee", () => {
    const email = confirmationEmail(EVENT, SLOT, "alex@example.com", attendees);
    const ics = Buffer.from(email.attachments![0].content, "base64")
      .toString("utf8")
      .replace(/\r\n /g, "");
    expect(ics).toContain("SUMMARY:Weekly Sync");
    expect(ics).toContain("DTSTART:20260831T130000Z");
    expect(ics).toContain("mailto:alex@example.com");
    expect(ics).toContain("mailto:sam@example.com");
    expect(ics).toContain("ORGANIZER;CN=Jane Smith:mailto:jane@example.com");
  });

  it("uses a UID stable across resends", () => {
    const first = confirmationEmail(EVENT, SLOT, "alex@example.com", attendees);
    const second = confirmationEmail(EVENT, SLOT, "alex@example.com", attendees);
    const uid = (email: typeof first) =>
      Buffer.from(email.attachments![0].content, "base64")
        .toString("utf8")
        .match(/UID:(.+)/)![1];
    expect(uid(first)).toBe(uid(second));
    expect(uid(first)).toContain("event-1.slot-1@get2gethr");
  });

  it("tells the reader to use the attachment when no calendar write happened", () => {
    const email = confirmationEmail(EVENT, SLOT, "alex@example.com", attendees, {
      calendarWritten: false,
    });
    expect(email.html).toMatch(/attached invitation/i);
  });

  it("mentions the calendar when the write succeeded", () => {
    const email = confirmationEmail(EVENT, SLOT, "alex@example.com", attendees, {
      calendarWritten: true,
    });
    expect(email.html).toMatch(/added to the organizer's calendar/i);
  });
});
