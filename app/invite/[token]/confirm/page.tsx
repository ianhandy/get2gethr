"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { motion, AnimatePresence } from "framer-motion";

interface InviteData {
  participant: { id: string; email: string; status: string };
  event: { id: string; title: string; timezone: string; status: string; initiatorName: string };
}

interface ProposedSlot { id: string; startTime: number; endTime: number }

// Read-only clock face showing a specific time
function ClockDisplay({ h24, min }: { h24: number; min: number }) {
  const SIZE = 200;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = 80;
  const secondsRef = useRef(0);

  function polar(angleDeg: number, r: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
  }

  const hourAngle   = ((h24 % 12) + min / 60) * 30;
  const minuteAngle = min * 6;
  const hourTip     = polar(hourAngle,   R * 0.5);
  const minuteTip   = polar(minuteAngle, R * 0.78);

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = i * 30;
    const inner = polar(a, R * 0.88);
    const outer = polar(a, R * 0.98);
    const num = i === 0 ? 12 : i;
    const numPos = polar(a, R * 0.72);
    return { inner, outer, num, numPos };
  });

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <circle cx={CX} cy={CY} r={R} fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="2" />

      {ticks.map(({ inner, outer, num, numPos }) => (
        <g key={num}>
          <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
            stroke="var(--color-border)" strokeWidth="1.5" />
          <text x={numPos.x} y={numPos.y} textAnchor="middle" dominantBaseline="central"
            fontSize="10" fill="var(--color-muted)" fontFamily="inherit">
            {num}
          </text>
        </g>
      ))}

      {/* Hour hand */}
      <motion.line
        x1={CX} y1={CY} x2={hourTip.x} y2={hourTip.y}
        stroke="var(--color-accent-a)" strokeWidth="4" strokeLinecap="round"
        initial={{ x2: CX, y2: CY }}
        animate={{ x2: hourTip.x, y2: hourTip.y }}
        transition={{ type: "spring", stiffness: 60, damping: 20, delay: 0.3 }}
      />

      {/* Minute hand */}
      <motion.line
        x1={CX} y1={CY} x2={minuteTip.x} y2={minuteTip.y}
        stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round"
        initial={{ x2: CX, y2: CY }}
        animate={{ x2: minuteTip.x, y2: minuteTip.y }}
        transition={{ type: "spring", stiffness: 60, damping: 20, delay: 0.5 }}
      />

      {/* Second hand — single sweep then stops */}
      <motion.line
        x1={CX} y1={CY}
        x2={polar(secondsRef.current * 6, R * 0.9).x}
        y2={polar(secondsRef.current * 6, R * 0.9).y}
        stroke="var(--color-accent-a)" strokeWidth="1" strokeLinecap="round" opacity="0.5"
        initial={{ rotate: 0 }}
        animate={{ rotate: 360 }}
        style={{ transformOrigin: `${CX}px ${CY}px` }}
        transition={{ duration: 1, delay: 0.2, ease: "linear", repeat: 0 }}
      />

      <circle cx={CX} cy={CY} r="4" fill="var(--color-primary)" />
    </svg>
  );
}

export default function ConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<InviteData | null>(null);
  const [slot, setSlot] = useState<ProposedSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [responded, setResponded] = useState<"confirmed" | "declined" | null>(null);

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then((r) => r.json())
      .then(async (d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        const evRes = await fetch(`/api/events/${d.event.id}`);
        const evData = await evRes.json();
        setSlot(evData.currentSlot ?? null);
      })
      .catch(() => setError("Failed to load."));
  }, [token]);

  async function respond(response: "confirmed" | "declined") {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invite/${token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      if (res.ok) {
        if (response === "confirmed") {
          import("canvas-confetti").then(({ default: confetti }) => {
            confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          });
        }
        setResponded(response);
      } else {
        const d = await res.json();
        setError(d.error ?? "Failed to submit response.");
      }
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  }

  if (error) return (
    <div className="rounded-2xl border p-8 text-center" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
      <p className="text-sm" style={{ color: "var(--color-accent-a)" }}>{error}</p>
    </div>
  );

  if (!data) return (
    <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-muted)" }}>
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      Loading…
    </div>
  );

  const { participant, event } = data;

  if (responded === "confirmed") return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl border p-10 text-center"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-2xl"
        style={{ background: "color-mix(in srgb, var(--color-accent-c) 20%, transparent)" }}>
        🎉
      </div>
      <h1 className="font-display mb-2 text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
        Time Confirmed!
      </h1>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        You&apos;ve confirmed your attendance for <strong>{event.title}</strong>. A final confirmation is on its way.
      </p>
    </motion.div>
  );

  if (responded === "declined") return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="rounded-2xl border p-10 text-center"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
      <h1 className="font-display mb-2 text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
        Looking for Another Time
      </h1>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        No problem! We&apos;ll find the next available slot and notify everyone.
      </p>
    </motion.div>
  );

  if (participant.status !== "joined") return (
    <div className="rounded-2xl border p-8" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        You need to join the event first.{" "}
        <a href={`/invite/${token}`} style={{ color: "var(--color-accent-a)" }} className="underline">
          Go back to the invitation
        </a>.
      </p>
    </div>
  );

  if (!slot) return (
    <div className="rounded-2xl border p-8 text-center" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
      <h1 className="font-display mb-2 text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
        No Time Proposed Yet
      </h1>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Still waiting for everyone to respond. You&apos;ll receive an email when it&apos;s time to confirm.
      </p>
    </div>
  );

  const startZoned = toZonedTime(new Date(slot.startTime * 1000), event.timezone);
  const endZoned   = toZonedTime(new Date(slot.endTime   * 1000), event.timezone);
  const h24 = startZoned.getHours();
  const min  = startZoned.getMinutes();

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-muted)" }}>Proposed meeting time</p>
        <h1 className="font-display text-3xl font-bold" style={{ color: "var(--color-primary)" }}>{event.title}</h1>
      </motion.div>

      {/* Clock + date */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="rounded-2xl border p-8 text-center"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="flex justify-center mb-4">
          <ClockDisplay h24={h24} min={min} />
        </div>
        <p className="font-display text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
          {format(startZoned, "EEEE, MMMM d, yyyy")}
        </p>
        <p className="mt-1 text-lg" style={{ color: "var(--color-muted)" }}>
          {format(startZoned, "h:mm a")} – {format(endZoned, "h:mm a")}
          <span className="ml-2 text-sm">({event.timezone})</span>
        </p>
      </motion.div>

      {/* Confirm / decline */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="rounded-2xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h2 className="font-display mb-5 text-lg font-bold" style={{ color: "var(--color-primary)" }}>
          Does this time work for you?
        </h2>
        <AnimatePresence>
          <div className="flex flex-col gap-3 sm:flex-row">
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
              onClick={() => respond("confirmed")} disabled={submitting}
              className="flex-1 rounded-2xl py-3.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--color-accent-c)" }}
            >
              Works for me ✓
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
              onClick={() => respond("declined")} disabled={submitting}
              className="flex-1 rounded-2xl border py-3.5 text-sm font-semibold disabled:opacity-60"
              style={{ color: "var(--color-accent-a)", borderColor: "var(--color-accent-a)", background: "transparent" }}
            >
              Try another time
            </motion.button>
          </div>
        </AnimatePresence>
        {submitting && <p className="mt-3 text-center text-xs" style={{ color: "var(--color-muted)" }}>Submitting…</p>}
      </motion.div>
    </div>
  );
}
