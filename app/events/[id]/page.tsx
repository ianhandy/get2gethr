"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

interface ParticipantRow {
  id: string;
  email: string;
  name: string | null;
  role: "organizer" | "attendee";
  status: "pending" | "joined" | "declined" | "removed";
  connection: {
    status: "connected" | "relink_required" | "revoked";
    provider: string;
    accountEmail: string | null;
    sourceCalendarCount: number;
    destinationCalendarId: string | null;
  } | null;
}

interface EventData {
  event: {
    id: string;
    title: string;
    description: string | null;
    organizerName: string;
    organizerEmail: string;
    startDate: string;
    endDate: string;
    durationMinutes: number;
    timezone: string;
    status: string;
    calendarWriteStatus: string;
    calendarWriteError: string | null;
  };
  participants: ParticipantRow[];
  currentSlot: { id: string; startTime: number; endTime: number } | null;
  confirmedSlot: { id: string; startTime: number; endTime: number } | null;
}

/**
 * Plain-language status, distinguishing "everyone agreed" from "the meeting
 * exists on a calendar". Conflating the two is what let the old UI claim a
 * meeting was confirmed when nothing had been written anywhere.
 */
const STATUS_COPY: Record<string, { label: string; detail: string }> = {
  draft: {
    label: "Connect your calendar",
    detail: "Invitations go out once your own availability is included.",
  },
  gathering: {
    label: "Waiting on responses",
    detail: "We'll propose a time as soon as everyone has connected or declined.",
  },
  proposing: {
    label: "Waiting on a decision",
    detail: "A time has been proposed and we're collecting answers.",
  },
  scheduling: {
    label: "Adding to the calendar",
    detail: "Everyone agreed. We're writing the meeting now.",
  },
  confirmed: {
    label: "Confirmed",
    detail: "The meeting is on the calendar and invitations have been sent.",
  },
  action_required: {
    label: "Needs your attention",
    detail: "Something needs a decision before this can finish.",
  },
  failed: {
    label: "No time worked",
    detail: "We couldn't find a slot everyone was free for.",
  },
  cancelled: { label: "Cancelled", detail: "This event was called off." },
};

function formatSlot(startSec: number, endSec: number, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(startSec * 1000));
  const time = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
  return `${day}, ${time(startSec * 1000)} – ${time(endSec * 1000)}`;
}

export default function EventDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();

  const organizerToken = searchParams.get("organizerToken");
  const connectToken = searchParams.get("connect");

  const [data, setData] = useState<EventData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizerToken) return;
    try {
      const response = await fetch(
        `/api/events/${id}?organizerToken=${encodeURIComponent(organizerToken)}`
      );
      const body = await response.json();
      if (!response.ok) setError(body.error ?? "We couldn't load this event.");
      else {
        setData(body);
        setError(null);
      }
    } catch {
      setError("We couldn't reach the server. Please try again.");
    }
  }, [id, organizerToken]);

  useEffect(() => {
    if (!organizerToken) return;
    // `ignore` drops a response that arrives after the event or token changed.
    let ignore = false;
    void (async () => {
      const response = await fetch(
        `/api/events/${id}?organizerToken=${encodeURIComponent(organizerToken)}`
      ).catch(() => null);
      if (ignore) return;
      if (!response) {
        setError("We couldn't reach the server. Please try again.");
        return;
      }
      const body = await response.json().catch(() => null);
      if (ignore) return;
      if (!response.ok || !body) setError(body?.error ?? "We couldn't load this event.");
      else setData(body);
    })();
    return () => {
      ignore = true;
    };
  }, [id, organizerToken]);

  // Poll only while something is actually expected to change.
  useEffect(() => {
    const status = data?.event.status;
    if (!status || ["confirmed", "failed", "cancelled"].includes(status)) return;
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [data?.event.status, load]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!organizerToken) return;
    setBusyAction(action);
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Organizer-Token": organizerToken,
        },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await response.json();
      if (!response.ok || body.ok === false) {
        setNotice(body.error ?? "That didn't work.");
      } else if (action === "remind") {
        setNotice(`Sent ${body.sent} reminder${body.sent === 1 ? "" : "s"}.`);
      } else if (action.endsWith("invitations")) {
        setNotice(`Sent ${body.sent} invitation${body.sent === 1 ? "" : "s"}.`);
      } else {
        setNotice("Done.");
      }
      await load();
    } catch {
      setNotice("We couldn't reach the server. Please try again.");
    } finally {
      setBusyAction(null);
    }
  }

  // Derived at render time rather than set from an effect: the missing
  // credential is a property of the URL, not something that has to be fetched.
  const message = !organizerToken
    ? "This page needs the organizer link that was created with the event. Check your browser history for the full address, including its organizerToken."
    : error;

  if (message) {
    return (
      <div
        role="alert"
        className="rounded-2xl border p-8"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <p className="text-sm" style={{ color: "#8A2E14" }}>
          {message}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <p role="status" className="text-sm" style={{ color: "var(--color-muted)" }}>
        Loading event…
      </p>
    );
  }

  const { event, participants } = data;
  const status = STATUS_COPY[event.status] ?? {
    label: event.status,
    detail: "",
  };
  const organizer = participants.find((person) => person.role === "organizer");
  const needsOrganizerCalendar =
    event.status === "draft" || organizer?.connection?.status !== "connected";

  const fade = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="space-y-5">
      <motion.div {...fade}>
        <h1
          className="font-display text-3xl font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {event.title}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          {event.startDate} to {event.endDate} · {event.durationMinutes} minutes ·{" "}
          {event.timezone}
        </p>
      </motion.div>

      <section
        className="rounded-2xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        aria-label="Status"
      >
        <p
          className="font-display text-lg font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {status.label}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          {status.detail}
        </p>

        {event.calendarWriteStatus === "failed" && event.calendarWriteError && (
          <div
            className="mt-4 rounded-xl px-4 py-3 text-sm"
            style={{ background: "#FFF5F3", color: "#8A2E14", border: "1px solid #FDDDD6" }}
          >
            <p className="font-medium">The meeting isn&rsquo;t on a calendar yet.</p>
            <p className="mt-1">{event.calendarWriteError}</p>
            <p className="mt-1">
              Everyone has the time and an calendar attachment by email in the meantime.
            </p>
          </div>
        )}

        {data.confirmedSlot && (
          <p className="mt-4 text-base font-medium" style={{ color: "var(--color-primary)" }}>
            {formatSlot(
              data.confirmedSlot.startTime,
              data.confirmedSlot.endTime,
              event.timezone
            )}
          </p>
        )}

        {data.currentSlot && !data.confirmedSlot && (
          <p className="mt-4 text-base font-medium" style={{ color: "var(--color-primary)" }}>
            Proposed:{" "}
            {formatSlot(
              data.currentSlot.startTime,
              data.currentSlot.endTime,
              event.timezone
            )}
          </p>
        )}
      </section>

      {needsOrganizerCalendar && connectToken && (
        <section
          className="rounded-2xl border p-6"
          style={{
            background: "var(--color-surface)",
            borderColor: "var(--color-accent-a)",
          }}
        >
          <h2
            className="font-display mb-2 text-lg font-bold"
            style={{ color: "var(--color-primary)" }}
          >
            Connect your calendar to send the invitations
          </h2>
          <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
            Your own availability has to be part of the search, and the confirmed meeting
            gets written to your calendar. Nothing is sent to anyone until this is done.
          </p>
          <a
            href={`/api/calendar/connect?token=${encodeURIComponent(
              connectToken
            )}&returnTo=${encodeURIComponent(
              `/events/${id}?organizerToken=${organizerToken}`
            )}`}
            className="inline-flex items-center justify-center rounded-2xl px-6 text-base font-semibold text-white focus:outline-none focus:ring-2 focus:ring-offset-2 [--tw-ring-color:var(--color-accent-c)]"
            style={{ background: "var(--color-accent-a)", minHeight: "48px" }}
          >
            Connect calendar
          </a>
        </section>
      )}

      <section
        className="rounded-2xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        aria-label="Participants"
      >
        <h2
          className="font-display mb-4 text-lg font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          People ({participants.filter((p) => p.status !== "removed").length})
        </h2>
        <ul className="space-y-3">
          {participants
            .filter((person) => person.status !== "removed")
            .map((person) => (
              <li
                key={person.id}
                // Wraps rather than clipping when an address is long.
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3 last:border-0"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="min-w-0">
                  <p
                    className="break-words text-sm font-medium"
                    style={{ color: "var(--color-primary)" }}
                  >
                    {person.name ?? person.email}
                    {person.role === "organizer" && (
                      <span className="ml-2 text-xs" style={{ color: "var(--color-muted)" }}>
                        organizer
                      </span>
                    )}
                  </p>
                  <p className="break-words text-xs" style={{ color: "var(--color-muted)" }}>
                    {person.email}
                    {person.connection?.status === "connected" &&
                      ` · ${person.connection.sourceCalendarCount} calendar${
                        person.connection.sourceCalendarCount === 1 ? "" : "s"
                      }`}
                    {person.connection?.status === "relink_required" &&
                      " · needs reconnecting"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <StatusPill status={person.status} />
                  {person.role === "attendee" && person.status === "pending" && (
                    <button
                      type="button"
                      onClick={() =>
                        act("remove_participant", { participantId: person.id })
                      }
                      disabled={busyAction !== null}
                      aria-label={`Remove ${person.email} from this event`}
                      className="rounded-lg px-3 text-xs underline-offset-2 hover:underline disabled:opacity-50 focus:outline-none focus:ring-2 [--tw-ring-color:var(--color-accent-c)]"
                      style={{ color: "var(--color-muted)", minHeight: "44px" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
        </ul>
      </section>

      <section
        className="rounded-2xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        aria-label="Organizer controls"
      >
        <h2
          className="font-display mb-4 text-lg font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          Controls
        </h2>

        <div className="flex flex-wrap gap-3">
          {event.status === "gathering" && (
            <>
              <Action
                label="Send reminders"
                onClick={() => act("remind")}
                busy={busyAction === "remind"}
                disabled={busyAction !== null}
              />
              <Action
                label="Resend invitations"
                onClick={() => act("resend_invitations")}
                busy={busyAction === "resend_invitations"}
                disabled={busyAction !== null}
              />
            </>
          )}

          {event.status === "proposing" && (
            <Action
              label="Confirm this time anyway"
              onClick={() => act("force_confirm")}
              busy={busyAction === "force_confirm"}
              disabled={busyAction !== null}
            />
          )}

          {event.calendarWriteStatus === "failed" && (
            <Action
              label="Try adding to calendar again"
              onClick={() => act("retry_calendar_write")}
              busy={busyAction === "retry_calendar_write"}
              disabled={busyAction !== null}
            />
          )}

          {!["cancelled", "confirmed"].includes(event.status) && (
            <Action
              label="Cancel event"
              onClick={() => act("cancel")}
              busy={busyAction === "cancel"}
              disabled={busyAction !== null}
              destructive
            />
          )}
        </div>

        <p role="status" aria-live="polite" className="mt-3 text-sm" style={{ color: "var(--color-muted)" }}>
          {notice ?? ""}
        </p>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: ParticipantRow["status"] }) {
  const palette: Record<string, { background: string; color: string; label: string }> = {
    joined: {
      background: "color-mix(in srgb, var(--color-accent-c) 20%, transparent)",
      color: "#1F5140",
      label: "Connected",
    },
    pending: {
      background: "color-mix(in srgb, var(--color-accent-b) 30%, transparent)",
      color: "#6B4E12",
      label: "Waiting",
    },
    declined: {
      background: "color-mix(in srgb, var(--color-accent-a) 18%, transparent)",
      color: "#8A2E14",
      label: "Declined",
    },
    removed: {
      background: "var(--color-border)",
      color: "var(--color-muted)",
      label: "Removed",
    },
  };
  const style = palette[status] ?? palette.pending;
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-medium"
      style={{ background: style.background, color: style.color }}
    >
      {style.label}
    </span>
  );
}

function Action({
  label,
  onClick,
  busy,
  disabled,
  destructive,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border px-4 text-sm font-medium disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 [--tw-ring-color:var(--color-accent-c)]"
      style={{
        minHeight: "44px",
        color: destructive ? "#8A2E14" : "var(--color-primary)",
        borderColor: destructive ? "var(--color-accent-a)" : "var(--color-border)",
        background: "transparent",
      }}
    >
      {busy ? "Working…" : label}
    </button>
  );
}
