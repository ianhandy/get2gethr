"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { motion, AnimatePresence } from "framer-motion";
import StatusBanner from "@/components/StatusBanner";

interface Participant {
  id: string;
  email: string;
  name: string | null;
  status: "pending" | "joined" | "declined";
  joinedAt: number | null;
}

interface ProposedSlot {
  id: string;
  startTime: number;
  endTime: number;
  slotIndex: number;
}

interface EventData {
  id: string;
  title: string;
  description: string | null;
  initiatorName: string;
  dateRangeStart: number;
  dateRangeEnd: number;
  durationMinutes: number;
  timezone: string;
  status: "gathering" | "proposing" | "confirmed" | "failed";
}

function formatTs(ts: number, tz: string) {
  return format(toZonedTime(new Date(ts * 1000), tz), "EEE, MMM d 'at' h:mm a");
}

const statusDot: Record<string, string> = {
  pending:  "var(--color-accent-b)",
  joined:   "var(--color-accent-c)",
  declined: "var(--color-accent-a)",
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  joined: "Joined",
  declined: "Declined",
};

export default function EventDashboard() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentSlot, setCurrentSlot] = useState<ProposedSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confettiFired = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${id}`);
      if (!res.ok) { setError("Event not found."); return; }
      const data = await res.json();
      setEvent(data.event);
      setParticipants(data.participants);
      setCurrentSlot(data.currentSlot);
    } catch { setError("Failed to load event."); }
  }, [id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  // Confetti on confirmed
  useEffect(() => {
    if (event?.status === "confirmed" && !confettiFired.current) {
      confettiFired.current = true;
      import("canvas-confetti").then(({ default: confetti }) => {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 } });
      });
    }
  }, [event?.status]);

  if (error) return <p className="text-sm" style={{ color: "var(--color-accent-a)" }}>{error}</p>;
  if (!event) return (
    <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-muted)" }}>
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      Loading…
    </div>
  );

  const pending  = participants.filter((p) => p.status === "pending").length;
  const joined   = participants.filter((p) => p.status === "joined").length;
  const declined = participants.filter((p) => p.status === "declined").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="font-display text-3xl font-bold leading-tight" style={{ color: "var(--color-primary)" }}>
            {event.title}
          </h1>
          <EventStatusPill status={event.status} />
        </div>
        {event.description && (
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>{event.description}</p>
        )}
        <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>
          Looking for a <strong>{event.durationMinutes}-min</strong> slot between{" "}
          {format(new Date(event.dateRangeStart * 1000), "MMM d")} and{" "}
          {format(new Date(event.dateRangeEnd * 1000), "MMM d, yyyy")}
          {" "}· {event.timezone}
        </p>
      </motion.div>

      {/* Status banner */}
      <AnimatePresence mode="wait">
        {event.status === "gathering" && (
          <StatusBanner key="gathering" variant="blue" pulse>
            Waiting for responses — {pending} pending, {joined} joined, {declined} declined.
          </StatusBanner>
        )}
        {event.status === "proposing" && currentSlot && (
          <StatusBanner key="proposing" variant="purple">
            Proposed:{" "}
            <strong>{formatTs(currentSlot.startTime, event.timezone)}</strong>.
            Waiting for confirmations.
          </StatusBanner>
        )}
        {event.status === "confirmed" && (
          <StatusBanner key="confirmed" variant="green">
            Meeting confirmed! A confirmation email has been sent to everyone.
          </StatusBanner>
        )}
        {event.status === "failed" && (
          <StatusBanner key="failed" variant="red">
            No common time was found. All participants have been notified.
          </StatusBanner>
        )}
      </AnimatePresence>

      {/* Progress bar */}
      {participants.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <div className="mb-1.5 flex justify-between text-xs" style={{ color: "var(--color-muted)" }}>
            <span>Participants responded</span>
            <span>{joined + declined}/{participants.length}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: "var(--color-accent-c)" }}
              initial={{ width: 0 }}
              animate={{ width: `${((joined + declined) / participants.length) * 100}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </motion.div>
      )}

      {/* Participant list */}
      <motion.div
        className="rounded-2xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
      >
        <h2 className="font-display mb-4 text-lg font-bold" style={{ color: "var(--color-primary)" }}>
          Participants
        </h2>
        <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          <AnimatePresence>
            {participants.map((p, i) => (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.35 }}
                className="flex items-center justify-between py-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ background: "var(--color-accent-a)" }}
                  >
                    {p.email[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium" style={{ color: "var(--color-primary)" }}>{p.email}</div>
                    {p.name && <div className="text-xs" style={{ color: "var(--color-muted)" }}>{p.name}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${p.status === "pending" ? "animate-pulse" : ""}`}
                    style={{ background: statusDot[p.status] }}
                  />
                  <span className="text-xs font-medium" style={{ color: statusDot[p.status] }}>
                    {statusLabel[p.status]}
                  </span>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </motion.div>

      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
        This page refreshes automatically every 10 seconds.
      </p>
    </div>
  );
}

function EventStatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; bg: string; color: string }> = {
    gathering: { label: "Gathering",  bg: "#EFF6FF", color: "#1E40AF" },
    proposing: { label: "Proposing",  bg: "#F5F3FF", color: "#5B21B6" },
    confirmed: { label: "Confirmed",  bg: "#F0FDF4", color: "#166534" },
    failed:    { label: "No Slots",   bg: "#FFF5F3", color: "#9B1C1C" },
  };
  const c = config[status] ?? config.gathering;
  return (
    <span className="mt-1 rounded-full px-3 py-1 text-xs font-semibold"
      style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}
