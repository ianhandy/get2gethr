"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import ParticipantChips from "@/components/ParticipantChip";
import TimeField from "@/components/TimeField";
import TimezoneField from "@/components/TimezoneField";
import FlyAwayCalendar from "@/components/FlyAwayCalendar";

const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return "1 hour";
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

/** Today in the browser's timezone, as YYYY-MM-DD. */
function todayLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface FieldError {
  field: string;
  message: string;
}

export default function CreateEventPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [flyAway, setFlyAway] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [organizerEmail, setOrganizerEmail] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [duration, setDuration] = useState(60);
  const [workingStart, setWorkingStart] = useState("09:00");
  const [workingEnd, setWorkingEnd] = useState("17:00");
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [participantEmails, setParticipantEmails] = useState<string[]>([]);
  const [website, setWebsite] = useState(""); // honeypot

  // A stable key means a retried submission cannot create a second event. It
  // is minted on first submit rather than during render, because generating it
  // during render would produce a different value on every re-render.
  const idempotencyKey = useRef<string | null>(null);

  const titleId = useId();
  const descriptionId = useId();
  const durationId = useId();
  const startId = useId();
  const endId = useId();
  const nameId = useId();
  const emailId = useId();
  const participantsLabelId = useId();
  const errorId = useId();

  const handleFlyAwayComplete = useCallback(() => {
    if (pendingUrl) router.push(pendingUrl);
  }, [pendingUrl, router]);

  function errorFor(field: string): string | undefined {
    return fieldErrors.find((entry) => entry.field === field)?.message;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors([]);

    if (participantEmails.length === 0) {
      setError("Add at least one person to invite.");
      return;
    }

    setLoading(true);
    idempotencyKey.current ??=
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          title,
          description: description || undefined,
          organizerName,
          organizerEmail,
          // Local calendar dates; the server resolves them in `timezone`.
          startDate,
          endDate,
          durationMinutes: duration,
          workingHoursStart: workingStart,
          workingHoursEnd: workingEnd,
          timezone,
          excludeWeekends,
          participantEmails,
          website,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "That didn't work. Check the form and try again.");
        setFieldErrors(data.fieldErrors ?? []);
        return;
      }

      // The organizer connects their calendar before anyone is invited — that
      // is what puts their own availability into the calculation.
      const next = `/events/${data.eventId}?organizerToken=${encodeURIComponent(
        data.organizerToken
      )}&connect=${encodeURIComponent(data.organizerInviteToken)}`;

      setPendingUrl(next);
      if (reduceMotion) router.push(next);
      else setFlyAway(true);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (flyAway) return <FlyAwayCalendar onComplete={handleFlyAwayComplete} />;

  const heroMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <div>
      <motion.div className="mb-10" {...heroMotion}>
        <h1
          className="font-display text-4xl font-bold leading-tight"
          style={{ color: "var(--color-primary)" }}
        >
          Find a time that{" "}
          <span style={{ color: "var(--color-accent-a)" }}>works.</span>
        </h1>
        <p className="mt-3 text-lg" style={{ color: "var(--color-muted)" }}>
          Set up an event, invite your group, and let everyone&rsquo;s calendars do the
          work.
        </p>
      </motion.div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Card index={0} title="Event details" reduceMotion={reduceMotion}>
          <Field label="Meeting title" htmlFor={titleId} required error={errorFor("title")}>
            <input
              id={titleId}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={200}
              placeholder="Weekly sync"
              aria-invalid={errorFor("title") ? true : undefined}
              className={inputClass}
              style={inputStyle}
            />
          </Field>

          <Field label="Description" htmlFor={descriptionId} error={errorFor("description")}>
            <textarea
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="What is this meeting about?"
              className={inputClass}
              style={{ ...inputStyle, minHeight: "72px", paddingTop: "10px" }}
            />
          </Field>

          {/* Stacks on narrow screens rather than squeezing two controls. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Duration"
              htmlFor={durationId}
              required
              error={errorFor("durationMinutes")}
            >
              <select
                id={durationId}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className={inputClass}
                style={inputStyle}
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {durationLabel(minutes)}
                  </option>
                ))}
              </select>
            </Field>

            <TimezoneField label="Timezone" value={timezone} onChange={setTimezone} />
          </div>
        </Card>

        <Card index={1} title="Availability window" reduceMotion={reduceMotion}>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Both dates are included, and every time below is in {timezone}.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Earliest date"
              htmlFor={startId}
              required
              error={errorFor("startDate")}
            >
              <input
                id={startId}
                type="date"
                value={startDate}
                min={todayLocal()}
                onChange={(event) => setStartDate(event.target.value)}
                required
                className={inputClass}
                style={inputStyle}
              />
            </Field>

            <Field
              label="Latest date"
              htmlFor={endId}
              required
              error={errorFor("endDate")}
            >
              <input
                id={endId}
                type="date"
                value={endDate}
                min={startDate || todayLocal()}
                onChange={(event) => setEndDate(event.target.value)}
                required
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>

          <fieldset className="mt-2 border-0 p-0">
            <legend
              className="mb-3 text-sm font-medium"
              style={{ color: "var(--color-primary)" }}
            >
              Working hours
            </legend>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <TimeField label="From" value={workingStart} onChange={setWorkingStart} />
              <TimeField label="Until" value={workingEnd} onChange={setWorkingEnd} />
            </div>
            {errorFor("workingHoursEnd") && (
              <p className="mt-2 text-sm" style={{ color: "var(--color-accent-a)" }}>
                {errorFor("workingHoursEnd")}
              </p>
            )}
          </fieldset>

          {/* A real checkbox: focusable, toggleable with Space, and announced
              with its state. The previous clickable div was none of those. */}
          <label
            className="mt-4 flex cursor-pointer items-center gap-3"
            style={{ minHeight: "44px" }}
          >
            <input
              type="checkbox"
              checked={excludeWeekends}
              onChange={(event) => setExcludeWeekends(event.target.checked)}
              className="h-5 w-5 rounded focus:outline-none focus:ring-2 [--tw-ring-color:var(--color-accent-c)]"
              style={{ accentColor: "var(--color-accent-c)" }}
            />
            <span className="text-sm" style={{ color: "var(--color-primary)" }}>
              Skip weekends
            </span>
          </label>
        </Card>

        <Card index={2} title="Your information" reduceMotion={reduceMotion}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Your name"
              htmlFor={nameId}
              required
              error={errorFor("organizerName")}
            >
              <input
                id={nameId}
                type="text"
                value={organizerName}
                onChange={(event) => setOrganizerName(event.target.value)}
                required
                autoComplete="name"
                placeholder="Jane Smith"
                className={inputClass}
                style={inputStyle}
              />
            </Field>

            <Field
              label="Your email"
              htmlFor={emailId}
              required
              error={errorFor("organizerEmail")}
            >
              <input
                id={emailId}
                type="email"
                value={organizerEmail}
                onChange={(event) => setOrganizerEmail(event.target.value)}
                required
                autoComplete="email"
                placeholder="jane@example.com"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>
        </Card>

        <Card index={3} title="Who's coming" reduceMotion={reduceMotion}>
          <span id={participantsLabelId} className="sr-only">
            Participant email addresses
          </span>
          <ParticipantChips
            emails={participantEmails}
            onChange={setParticipantEmails}
            labelledBy={participantsLabelId}
          />
          {errorFor("participantEmails") && (
            <p className="mt-2 text-sm" style={{ color: "var(--color-accent-a)" }}>
              {errorFor("participantEmails")}
            </p>
          )}
        </Card>

        {/* Invisible to people, irresistible to form-filling bots. */}
        <div aria-hidden="true" className="hidden">
          <label htmlFor="website">Leave this field empty</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>

        {error && (
          <div
            id={errorId}
            role="alert"
            className="rounded-xl px-4 py-3 text-sm"
            style={{
              background: "#FFF5F3",
              color: "#8A2E14",
              border: "1px solid #FDDDD6",
            }}
          >
            {error}
          </div>
        )}

        <motion.button
          type="submit"
          disabled={loading}
          whileHover={reduceMotion || loading ? undefined : { scale: 1.01 }}
          whileTap={reduceMotion || loading ? undefined : { scale: 0.99 }}
          className="w-full rounded-2xl py-4 text-base font-semibold text-white transition-opacity disabled:opacity-60"
          style={{ background: "var(--color-accent-a)", minHeight: "44px" }}
        >
          {loading ? "Creating…" : "Create event"}
        </motion.button>

        <p className="text-center text-sm" style={{ color: "var(--color-muted)" }}>
          You&rsquo;ll connect your own calendar next. Invitations go out after that.
        </p>
      </form>
    </div>
  );
}

function Card({
  index,
  title,
  children,
  reduceMotion,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
  reduceMotion: boolean | null;
}) {
  const animation = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 24 },
        animate: { opacity: 1, y: 0 },
        transition: {
          delay: index * 0.08,
          duration: 0.45,
          ease: [0.22, 1, 0.36, 1] as const,
        },
      };

  return (
    <motion.section
      {...animation}
      className="rounded-2xl border p-5 sm:p-6 md:p-8"
      style={{
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
      }}
    >
      <h2
        className="font-display mb-5 text-lg font-bold"
        style={{ color: "var(--color-primary)" }}
      >
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </motion.section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium"
        style={{ color: "var(--color-primary)" }}
      >
        {label}
        {required && (
          <span className="ml-1" style={{ color: "var(--color-accent-a)" }} aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-sm" style={{ color: "var(--color-accent-a)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border px-3.5 text-base transition-colors focus:outline-none " +
  "focus:ring-2 focus:ring-offset-0 " +
  "[border-color:var(--color-border)] " +
  "[background:var(--color-surface)] " +
  "[color:var(--color-primary)] " +
  "[--tw-ring-color:var(--color-accent-c)]";

// 44px keeps every control at the minimum comfortable touch target.
const inputStyle: React.CSSProperties = { minHeight: "44px" };
