"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { DeviceScheduleScanner } from "@/components/device-schedule-scanner";
import {
  deviceCalendarPlatform,
  readDeviceBusyTimes,
  subscribeDeviceCalendarPlatform,
} from "@/lib/device-calendar";

interface ConnectionSummary {
  status: "connected" | "relink_required" | "revoked";
  provider: string;
  accountEmail: string | null;
  sourceCalendarCount: number;
}

interface InviteData {
  event: {
    id: string;
    title: string;
    description: string | null;
    organizerName: string;
    startDate: string;
    endDate: string;
    durationMinutes: number;
    timezone: string;
    status: string;
    calendarWriteStatus: string;
  };
  viewer: {
    role: "attendee" | "organizer";
    id?: string;
    email?: string;
    status?: "pending" | "joined" | "declined" | "removed";
    connection?: ConnectionSummary | null;
    manualSchedule?: boolean;
  };
  others?: { total: number; joined: number; declined: number; pending: number };
  currentSlot: { id: string; startTime: number; endTime: number } | null;
  confirmedSlot: { id: string; startTime: number; endTime: number } | null;
  providers: string[];
}

/** Human-readable messages for every way a connection can fail. */
const CONNECT_ERRORS: Record<string, string> = {
  denied:
    "The calendar connection was cancelled. Nothing was shared, and you can try again whenever you like.",
  account_mismatch:
    "That calendar belongs to a different email address. Sign in with the account this invitation was sent to.",
  expired_state:
    "That link timed out for security reasons. Start the connection again.",
  replayed_state:
    "That link had already been used. Start the connection again.",
  invalid_state: "We couldn't verify that request. Start the connection again.",
  provider_error:
    "Your calendar provider couldn't complete the connection. Please try again in a moment.",
};

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  microsoft: "Microsoft 365 / Outlook",
  apple: "Apple iCloud",
  exchange: "Exchange",
};

function formatDateRange(startDate: string, endDate: string): string {
  const format = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };
  return startDate === endDate
    ? format(startDate)
    : `${format(startDate)} – ${format(endDate)}`;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();

  const [data, setData] = useState<InviteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const devicePlatform = useSyncExternalStore(
    subscribeDeviceCalendarPlatform,
    deviceCalendarPlatform,
    () => null
  );
  const [readingDeviceCalendar, setReadingDeviceCalendar] = useState(false);
  const [deviceCalendarError, setDeviceCalendarError] = useState<string | null>(null);

  const connectError = searchParams.get("error");
  const justConnected = searchParams.get("connected") === "1";

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/invite/${token}`);
      const body = await response.json();
      if (!response.ok) setError(body.error ?? "We couldn't load this invitation.");
      else setData(body);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    }
  }, [token]);

  useEffect(() => {
    // `ignore` drops the result of a request whose token is already stale, so
    // a fast navigation cannot land older data on a newer invitation.
    let ignore = false;
    void (async () => {
      const response = await fetch(`/api/invite/${token}`).catch(() => null);
      if (ignore) return;
      if (!response) {
        setError("We couldn't reach the server. Check your connection and try again.");
        return;
      }
      const body = await response.json().catch(() => null);
      if (ignore) return;
      if (!response.ok || !body) {
        setError(body?.error ?? "We couldn't load this invitation.");
      } else {
        setData(body);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [token]);

  async function handleDecline() {
    setDeclining(true);
    try {
      const response = await fetch(`/api/invite/${token}/decline`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) setError(body.error ?? "We couldn't record that.");
      else await load();
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setDeclining(false);
    }
  }

  async function handleDeviceCalendar() {
    if (!data) return;
    setReadingDeviceCalendar(true);
    setDeviceCalendarError(null);
    try {
      const result = await readDeviceBusyTimes({
        startDate: data.event.startDate,
        endDate: data.event.endDate,
        timeZone: data.event.timezone,
      });
      const response = await fetch(`/api/invite/${token}/device-calendar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervals: result.intervals }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "We couldn't add your busy times.");
      }
      await load();
    } catch (deviceError) {
      setDeviceCalendarError(
        deviceError instanceof Error
          ? deviceError.message
          : "We couldn't read your calendars."
      );
    } finally {
      setReadingDeviceCalendar(false);
    }
  }

  const fade = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

  if (error) {
    return (
      <div
        role="alert"
        className="ios-card rounded-2xl border p-8 text-center"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <p role="status" className="text-sm" style={{ color: "var(--color-muted)" }}>
        Loading invitation…
      </p>
    );
  }

  const { event, viewer } = data;
  const connected =
    viewer.status === "joined" &&
    (viewer.connection?.status === "connected" || viewer.manualSchedule === true);

  if (viewer.status === "declined") {
    return (
      <motion.div
        {...fade}
        className="ios-card rounded-2xl border p-10 text-center"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h1
          className="font-display mb-2 text-2xl font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          Invitation declined
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          You let {event.organizerName} know you can&rsquo;t make{" "}
          <strong>{event.title}</strong>.
        </p>
      </motion.div>
    );
  }

  if (connected) {
    return (
      <motion.div
        {...fade}
        className="ios-card rounded-2xl border p-10 text-center"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h1
          className="font-display mb-3 text-2xl font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          You&rsquo;re all set
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {viewer.manualSchedule && !viewer.connection
            ? "Your busy times are included."
            : "Your calendar is connected."}{" "}
          We&rsquo;ll email <strong>{viewer.email}</strong> as soon as there&rsquo;s a time to
          confirm.
        </p>

        {viewer.connection && (
          <dl
            className="mx-auto mt-6 max-w-sm space-y-2 rounded-xl p-4 text-left text-sm"
            style={{ background: "var(--color-bg)" }}
          >
            <ConnectionRow
              label="Account"
              value={viewer.connection.accountEmail ?? viewer.email ?? "Connected"}
            />
            <ConnectionRow
              label="Provider"
              value={PROVIDER_LABELS[viewer.connection.provider] ?? viewer.connection.provider}
            />
            <ConnectionRow
              label="Calendars read"
              value={`${viewer.connection.sourceCalendarCount} calendar${
                viewer.connection.sourceCalendarCount === 1 ? "" : "s"
              }`}
            />
          </dl>
        )}

        {data.others && (
          <p className="mt-5 text-sm" style={{ color: "var(--color-muted)" }}>
            {data.others.joined} of {data.others.total + 1} people connected so far.
          </p>
        )}

        {viewer.role === "attendee" && devicePlatform && (
          <button
            type="button"
            onClick={handleDeviceCalendar}
            disabled={readingDeviceCalendar}
            className="mt-5 min-h-11 rounded-lg px-4 text-sm font-semibold transition-colors hover:underline disabled:opacity-50 focus:outline-none focus:ring-2 [--tw-ring-color:var(--color-accent-c)]"
            style={{ color: "var(--color-accent-a)" }}
          >
            {readingDeviceCalendar ? "checking calendars…" : "refresh busy times"}
          </button>
        )}

        {viewer.role === "attendee" && devicePlatform === "ios" && (
          <div className="mt-3">
            <DeviceScheduleScanner
              token={token}
              event={event}
              onSaved={load}
              label="scan another schedule"
            />
          </div>
        )}

        {deviceCalendarError && (
          <p className="mt-3 text-sm" role="alert" style={{ color: "var(--color-danger)" }}>
            {deviceCalendarError}
          </p>
        )}
      </motion.div>
    );
  }

  return (
    <div className="space-y-5">
      <motion.div {...fade}>
        <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-muted)" }}>
          Invitation from {event.organizerName}
        </p>
        <h1
          className="font-display text-3xl font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {event.title}
        </h1>
        {event.description && (
          <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>
            {event.description}
          </p>
        )}
      </motion.div>

      <section
        className="ios-card rounded-2xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        aria-label="Meeting details"
      >
        <dl className="space-y-3">
          {viewer.email && <ConnectionRow label="Invited as" value={viewer.email} />}
          <ConnectionRow
            label="Date window"
            value={formatDateRange(event.startDate, event.endDate)}
          />
          <ConnectionRow label="Length" value={`${event.durationMinutes} minutes`} />
          <ConnectionRow label="Times shown in" value={event.timezone} />
        </dl>
      </section>

      {connectError && (
        <div
          role="alert"
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "var(--color-danger-surface)",
            color: "var(--color-danger)",
            border: "1px solid color-mix(in srgb, var(--color-danger) 28%, transparent)",
          }}
        >
          {CONNECT_ERRORS[connectError] ?? CONNECT_ERRORS.provider_error}
        </div>
      )}

      {justConnected && !connected && (
        <div
          role="status"
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: "var(--color-bg)", color: "var(--color-primary)" }}
        >
          Finishing up your connection…
        </div>
      )}

      {deviceCalendarError && (
        <div
          role="alert"
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "var(--color-danger-surface)",
            color: "var(--color-danger)",
          }}
        >
          {deviceCalendarError}
        </div>
      )}

      <section
        className="ios-card rounded-2xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h2
          className="font-display mb-2 text-lg font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          Connect your calendar
        </h2>
        <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
          We read <strong>only when you&rsquo;re busy</strong> — never your event titles,
          guests, or notes.
        </p>

        {data.providers.length > 1 && (
          <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
            Works with{" "}
            {data.providers
              .filter((provider) => provider !== "other")
              .map((provider) => PROVIDER_LABELS[provider] ?? provider)
              .join(", ")}
            .
          </p>
        )}

        {viewer.role === "attendee" && devicePlatform && (
          <>
            <button
              type="button"
              onClick={handleDeviceCalendar}
              disabled={readingDeviceCalendar}
              className="inline-flex w-full items-center justify-center rounded-xl px-6 text-base font-semibold shadow-md transition-shadow hover:shadow-lg disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 [--tw-ring-color:var(--color-accent-c)]"
              style={{
                background: "var(--color-accent-a)",
                color: "var(--color-on-accent)",
                minHeight: "52px",
              }}
            >
              {readingDeviceCalendar
                ? "checking calendars…"
                : `Use calendars on this ${devicePlatform === "ios" ? "iPhone" : "device"}`}
            </button>
            <div className="my-4 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>or</span>
              <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
            </div>
          </>
        )}

        <a
          href={`/api/calendar/connect?token=${encodeURIComponent(token)}`}
          className="inline-flex w-full items-center justify-center rounded-xl px-6 text-base font-semibold shadow-md transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 [--tw-ring-color:var(--color-accent-c)]"
          style={{
            background: "var(--color-accent-a)",
            color: "var(--color-on-accent)",
            minHeight: "52px",
          }}
        >
          Connect calendar
        </a>

        {viewer.role === "attendee" && devicePlatform === "ios" && (
          <div className="mt-3">
            <DeviceScheduleScanner token={token} event={event} onSaved={load} />
          </div>
        )}

        {!devicePlatform && data.providers.includes("apple") && (
          <p className="mt-4 text-xs" style={{ color: "var(--color-muted)" }}>
            Apple iCloud needs an app-specific password, which you&rsquo;ll be asked for
            during setup.
          </p>
        )}
      </section>

      <div className="text-center">
        <button
          type="button"
          onClick={handleDecline}
          disabled={declining}
          className="rounded-lg px-4 text-sm transition-colors hover:underline disabled:opacity-50 focus:outline-none focus:ring-2 [--tw-ring-color:var(--color-accent-c)]"
          style={{ color: "var(--color-muted)", minHeight: "44px" }}
        >
          {declining ? "Declining…" : "I can't make it — decline"}
        </button>
      </div>
    </div>
  );
}

function ConnectionRow({ label, value }: { label: string; value: string }) {
  return (
    // Wraps instead of clipping when the label or value is long.
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <dt className="w-32 flex-shrink-0" style={{ color: "var(--color-muted)" }}>
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words font-medium" style={{ color: "var(--color-primary)" }}>
        {value}
      </dd>
    </div>
  );
}
