"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

interface InviteData {
  event: {
    id: string;
    title: string;
    timezone: string;
    status: string;
    organizerName: string;
    calendarWriteStatus: string;
  };
  viewer: { status?: string; email?: string };
  currentSlot: { id: string; startTime: number; endTime: number } | null;
  confirmedSlot: { id: string; startTime: number; endTime: number } | null;
}

const SIZE = 200;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 80;

function polar(angleDeg: number, r: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

/**
 * A decorative clock showing the proposed time.
 *
 * Purely presentational: the same time is stated in text directly below, so
 * this is `aria-hidden` and carries no interaction. The previous version read
 * a ref during render to place a sweeping second hand, which React explicitly
 * forbids — the hand is gone rather than papered over.
 */
function ClockDisplay({ hours, minutes }: { hours: number; minutes: number }) {
  const reduceMotion = useReducedMotion();
  const hourTip = polar(((hours % 12) + minutes / 60) * 30, R * 0.5);
  const minuteTip = polar(minutes * 6, R * 0.78);

  const handTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 60, damping: 20, delay: 0.3 };

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angle = i * 30;
    return {
      inner: polar(angle, R * 0.88),
      outer: polar(angle, R * 0.98),
      numeral: i === 0 ? 12 : i,
      numeralPosition: polar(angle, R * 0.72),
    };
  });

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
      focusable="false"
      style={{ maxWidth: "100%" }}
    >
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="var(--color-surface)"
        stroke="var(--color-border)"
        strokeWidth="2"
      />
      {ticks.map(({ inner, outer, numeral, numeralPosition }) => (
        <g key={numeral}>
          <line
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke="var(--color-border)"
            strokeWidth="1.5"
          />
          <text
            x={numeralPosition.x}
            y={numeralPosition.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="10"
            fill="var(--color-muted)"
          >
            {numeral}
          </text>
        </g>
      ))}
      <motion.line
        x1={CX}
        y1={CY}
        stroke="var(--color-accent-a)"
        strokeWidth="4"
        strokeLinecap="round"
        initial={{ x2: reduceMotion ? hourTip.x : CX, y2: reduceMotion ? hourTip.y : CY }}
        animate={{ x2: hourTip.x, y2: hourTip.y }}
        transition={handTransition}
      />
      <motion.line
        x1={CX}
        y1={CY}
        stroke="var(--color-primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{
          x2: reduceMotion ? minuteTip.x : CX,
          y2: reduceMotion ? minuteTip.y : CY,
        }}
        animate={{ x2: minuteTip.x, y2: minuteTip.y }}
        transition={{ ...handTransition, delay: reduceMotion ? 0 : 0.5 }}
      />
      <circle cx={CX} cy={CY} r="4" fill="var(--color-primary)" />
    </svg>
  );
}

function partsInZone(ms: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(ms));
  const field = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return { hours: field("hour"), minutes: field("minute") };
}

function formatDay(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ms));
}

function formatClock(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

export default function ConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const reduceMotion = useReducedMotion();

  const [data, setData] = useState<InviteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [responded, setResponded] = useState<"confirmed" | "declined" | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/invite/${token}`);
      const body = await response.json();
      if (!response.ok) setError(body.error ?? "We couldn't load this invitation.");
      else setData(body);
    } catch {
      setError("We couldn't reach the server. Please try again.");
    }
  }, [token]);

  useEffect(() => {
    // `ignore` drops a response that arrives after the token changed.
    let ignore = false;
    void (async () => {
      const response = await fetch(`/api/invite/${token}`).catch(() => null);
      if (ignore) return;
      if (!response) {
        setError("We couldn't reach the server. Please try again.");
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

  async function respond(answer: "confirmed" | "declined") {
    if (!data?.currentSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invite/${token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: answer, slotId: data.currentSlot.id }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "We couldn't record your answer.");
        // The slot may have moved on; reload so the page shows the real state.
        await load();
        return;
      }

      if (answer === "confirmed" && !reduceMotion) {
        const { default: confetti } = await import("canvas-confetti");
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      }
      setResponded(answer);
      await load();
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const fade = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

  if (error && !data) {
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
        Loading…
      </p>
    );
  }

  const { event, viewer } = data;

  if (responded === "confirmed") {
    // "Confirmed" here means this person answered — not that the meeting
    // exists on a calendar yet. The wording keeps that distinction.
    const written = event.calendarWriteStatus === "written";
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
          Thanks — that&rsquo;s a yes from you
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {written
            ? `${event.title} is on the calendar. Check your inbox for the invitation.`
            : `We'll add ${event.title} to the calendar once everyone has answered, and email you the invitation.`}
        </p>
      </motion.div>
    );
  }

  if (responded === "declined") {
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
          Looking for another time
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No problem — we&rsquo;ll propose the next time that works and let everyone know.
        </p>
      </motion.div>
    );
  }

  if (viewer.status !== "joined") {
    return (
      <div
        className="ios-card rounded-2xl border p-8"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Connect your calendar first.{" "}
          <Link
            href={`/invite/${token}`}
            style={{ color: "var(--color-accent-a)" }}
            className="underline"
          >
            Go back to the invitation
          </Link>
          .
        </p>
      </div>
    );
  }

  if (!data.currentSlot) {
    return (
      <div
        className="ios-card rounded-2xl border p-8 text-center"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h1
          className="font-display mb-2 text-2xl font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          No time to confirm yet
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          We&rsquo;re still waiting on everyone. You&rsquo;ll get an email the moment
          there&rsquo;s a time to look at.
        </p>
      </div>
    );
  }

  const startMs = data.currentSlot.startTime * 1000;
  const endMs = data.currentSlot.endTime * 1000;
  const { hours, minutes } = partsInZone(startMs, event.timezone);
  const readableTime = `${formatDay(startMs, event.timezone)}, ${formatClock(
    startMs,
    event.timezone
  )} to ${formatClock(endMs, event.timezone)} ${event.timezone}`;

  return (
    <div className="space-y-6">
      <motion.div {...fade}>
        <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-muted)" }}>
          Proposed meeting time
        </p>
        <h1
          className="font-display text-3xl font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {event.title}
        </h1>
      </motion.div>

      <motion.section
        {...fade}
        className="ios-card rounded-2xl border p-6 text-center sm:p-8"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        aria-label="Proposed time"
      >
        <div className="mb-4 flex justify-center">
          <ClockDisplay hours={hours} minutes={minutes} />
        </div>
        {/* The authoritative statement of the time, for everyone. */}
        <p
          className="font-display text-2xl font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {formatDay(startMs, event.timezone)}
        </p>
        <p className="mt-1 text-lg" style={{ color: "var(--color-muted)" }}>
          {formatClock(startMs, event.timezone)} – {formatClock(endMs, event.timezone)}
          <span className="ml-2 text-sm">({event.timezone})</span>
        </p>
        <span className="sr-only">{readableTime}</span>
      </motion.section>

      {error && (
        <div
          role="alert"
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "var(--color-danger-surface)",
            color: "var(--color-danger)",
            border: "1px solid color-mix(in srgb, var(--color-danger) 28%, transparent)",
          }}
        >
          {error}
        </div>
      )}

      <motion.section
        {...fade}
        className="ios-card rounded-2xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h2
          className="font-display mb-5 text-lg font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          Does this time work for you?
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => respond("confirmed")}
            disabled={submitting}
            className="flex-1 rounded-xl px-4 text-base font-semibold disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 [--tw-ring-color:var(--color-accent-c)]"
            style={{
              background: "var(--color-accent-c)",
              color: "var(--color-on-accent)",
              minHeight: "52px",
            }}
          >
            Works for me
          </button>
          <button
            type="button"
            onClick={() => respond("declined")}
            disabled={submitting}
            className="flex-1 rounded-xl border px-4 text-base font-semibold disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 [--tw-ring-color:var(--color-accent-c)]"
            style={{
              color: "var(--color-danger)",
              borderColor: "var(--color-accent-a)",
              background: "transparent",
              minHeight: "48px",
            }}
          >
            Try another time
          </button>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {submitting ? "Sending your answer" : ""}
        </p>
      </motion.section>
    </div>
  );
}
