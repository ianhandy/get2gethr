"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import ClockPicker from "@/components/ClockPicker";
import ParticipantChips from "@/components/ParticipantChip";
import FlyAwayCalendar from "@/components/FlyAwayCalendar";

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Toronto", "America/Vancouver", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata",
  "Australia/Sydney", "Pacific/Auckland",
];

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};

export default function CreateEventPage() {
  const router = useRouter();
  const [flyAway, setFlyAway] = useState(false);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [initiatorName, setInitiatorName] = useState("");
  const [initiatorEmail, setInitiatorEmail] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [duration, setDuration] = useState(60);
  const [whStart, setWhStart] = useState("09:00");
  const [whEnd, setWhEnd] = useState("17:00");
  const [timezone, setTimezone] = useState(
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "America/New_York"
  );
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [participantEmails, setParticipantEmails] = useState<string[]>([]);

  const handleFlyAwayComplete = useCallback(() => {
    if (pendingEventId) router.push(`/events/${pendingEventId}`);
  }, [pendingEventId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (participantEmails.length === 0) {
      setError("Add at least one participant email (press Enter after each).");
      return;
    }

    const startMs = Math.floor(new Date(dateStart).getTime() / 1000);
    const endMs = Math.floor(new Date(dateEnd).getTime() / 1000);
    if (endMs <= startMs) { setError("End date must be after start date."); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description: description || undefined,
          initiatorName, initiatorEmail,
          dateRangeStart: startMs, dateRangeEnd: endMs,
          durationMinutes: duration,
          workingHoursStart: whStart, workingHoursEnd: whEnd,
          timezone, excludeWeekends,
          participantEmails,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ? JSON.stringify(data.error) : "Failed to create event."); return; }
      setPendingEventId(data.eventId);
      setFlyAway(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (flyAway) return <FlyAwayCalendar onComplete={handleFlyAwayComplete} />;

  return (
    <div>
      {/* Hero */}
      <motion.div
        className="mb-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="font-display text-4xl font-bold leading-tight" style={{ color: "var(--color-primary)" }}>
          Find a time that{" "}
          <span style={{ color: "var(--color-accent-a)" }}>works.</span>
        </h1>
        <p className="mt-3 text-lg" style={{ color: "var(--color-muted)" }}>
          Set up an event, invite your group, and let everyone's calendars do the work.
        </p>
      </motion.div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Section: Event Details */}
        <Card index={0} title="Event Details">
          <Field label="Meeting Title" required>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              required maxLength={200} placeholder="Weekly Sync, Team Lunch…"
              className={inputClass} />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2} maxLength={1000} placeholder="What's this meeting about?"
              className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Duration" required>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                className={inputClass}>
                {[15, 30, 45, 60, 90, 120].map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : d === 60 ? "1 hour" : `${d / 60} hours`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Timezone" required>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
                className={inputClass}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
          </div>
        </Card>

        {/* Section: Date Window */}
        <Card index={1} title="Availability Window">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Earliest Date" required>
              <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
                required className={inputClass} />
            </Field>
            <Field label="Latest Date" required>
              <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
                required className={inputClass} />
            </Field>
          </div>

          {/* Clock pickers */}
          <div className="mt-6">
            <p className="mb-4 text-sm font-medium" style={{ color: "var(--color-muted)" }}>
              Working Hours
            </p>
            <div className="flex flex-col gap-8 sm:flex-row sm:justify-around">
              <ClockPicker value={whStart} onChange={setWhStart} label="From" />
              <ClockPicker value={whEnd} onChange={setWhEnd} label="Until" />
            </div>
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-3">
            <div
              onClick={() => setExcludeWeekends((v) => !v)}
              className="relative h-6 w-11 cursor-pointer rounded-full transition-colors"
              style={{ background: excludeWeekends ? "var(--color-accent-c)" : "var(--color-border)" }}
            >
              <div
                className="absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform"
                style={{ left: excludeWeekends ? "calc(100% - 20px)" : "4px" }}
              />
            </div>
            <span className="text-sm" style={{ color: "var(--color-primary)" }}>Exclude weekends</span>
          </label>
        </Card>

        {/* Section: Your Info */}
        <Card index={2} title="Your Information">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Your Name" required>
              <input type="text" value={initiatorName} onChange={(e) => setInitiatorName(e.target.value)}
                required placeholder="Jane Smith" className={inputClass} />
            </Field>
            <Field label="Your Email" required>
              <input type="email" value={initiatorEmail} onChange={(e) => setInitiatorEmail(e.target.value)}
                required placeholder="jane@example.com" className={inputClass} />
            </Field>
          </div>
        </Card>

        {/* Section: Participants */}
        <Card index={3} title="Participants">
          <p className="mb-3 text-sm" style={{ color: "var(--color-muted)" }}>
            Type an email and press <kbd className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono">Enter</kbd> to add. Add as many as you need.
          </p>
          <ParticipantChips emails={participantEmails} onChange={setParticipantEmails} />
          {participantEmails.length > 0 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-2 text-xs"
              style={{ color: "var(--color-muted)" }}
            >
              {participantEmails.length} participant{participantEmails.length !== 1 ? "s" : ""} added
            </motion.p>
          )}
        </Card>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl px-4 py-3 text-sm"
            style={{ background: "#FFF5F3", color: "var(--color-accent-a)", border: "1px solid #FDDDD6" }}
          >
            {error}
          </motion.div>
        )}

        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: loading ? 1 : 1.02 }}
          whileTap={{ scale: loading ? 1 : 0.97 }}
          className="w-full rounded-2xl py-4 text-base font-semibold text-white transition-opacity disabled:opacity-60"
          style={{ background: "var(--color-accent-a)" }}
        >
          {loading ? "Creating…" : "Create Event & Send Invites →"}
        </motion.button>
      </form>
    </div>
  );
}

function Card({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <motion.section
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className="rounded-2xl border p-6 md:p-8"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <h2 className="font-display mb-5 text-lg font-bold" style={{ color: "var(--color-primary)" }}>
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </motion.section>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium" style={{ color: "var(--color-primary)" }}>
        {label}
        {required && <span className="ml-1" style={{ color: "var(--color-accent-a)" }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors focus:outline-none " +
  "focus:ring-2 focus:ring-offset-0 " +
  "[border-color:var(--color-border)] " +
  "[background:var(--color-surface)] " +
  "[color:var(--color-primary)] " +
  "[--tw-ring-color:var(--color-accent-c)]";
