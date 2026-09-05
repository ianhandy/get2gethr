"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import ParticipantChips from "@/components/ParticipantChip";

const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

type TimingMode = "asap" | "range";

interface FieldError {
  field: string;
  message: string;
}

const subscribeToClientDefaults = () => () => {};
const getServerDefaults = () => "||UTC";

function formatLocalDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function getClientDefaults(): string {
  let timezone = "UTC";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // UTC remains the safe fallback.
  }
  return `${localDateOffset(0)}|${localDateOffset(30)}|${timezone}`;
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return "1 hour";
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

export default function CreateEventPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [organizerEmail, setOrganizerEmail] = useState("");
  const clientDefaults = useSyncExternalStore(
    subscribeToClientDefaults,
    getClientDefaults,
    getServerDefaults
  );
  const [defaultStartDate, defaultEndDate, timezone] = clientDefaults.split("|");
  const [timingMode, setTimingMode] = useState<TimingMode>("asap");
  const [startDateOverride, setStartDate] = useState<string | null>(null);
  const [endDateOverride, setEndDate] = useState<string | null>(null);
  const customStartDate = startDateOverride ?? defaultStartDate;
  const customEndDate = endDateOverride ?? defaultEndDate;
  const startDate = timingMode === "range" ? customStartDate : defaultStartDate;
  const endDate = timingMode === "range" ? customEndDate : defaultEndDate;
  const [duration, setDuration] = useState(30);
  const [participantEmails, setParticipantEmails] = useState<string[]>([]);
  const [website, setWebsite] = useState("");
  const idempotencyKey = useRef<string | null>(null);

  const titleId = useId();
  const descriptionId = useId();
  const durationId = useId();
  const startId = useId();
  const endId = useId();
  const nameId = useId();
  const emailId = useId();
  const participantsLabelId = useId();

  const isValid =
    title.trim().length > 0 &&
    organizerName.trim().length > 0 &&
    organizerEmail.includes("@") &&
    participantEmails.length > 0;

  function errorFor(field: string): string | undefined {
    return fieldErrors.find((entry) => entry.field === field)?.message;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors([]);
    if (!isValid) return;

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
          startDate,
          endDate,
          durationMinutes: duration,
          workingHoursStart: "00:00",
          workingHoursEnd: "24:00",
          timezone,
          excludeWeekends: false,
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

      router.push(
        `/events/${data.eventId}?organizerToken=${encodeURIComponent(
          data.organizerToken
        )}&connect=${encodeURIComponent(data.organizerInviteToken)}`
      );
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ios-form" noValidate>
      <Card title="Event details">
        <Field label="What are you planning?" htmlFor={titleId} error={errorFor("title")}>
          <input
            id={titleId}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value.toLowerCase())}
            required
            maxLength={200}
            placeholder="dinner at ours"
            autoComplete="off"
            aria-invalid={errorFor("title") ? true : undefined}
            className="ios-input"
          />
        </Field>

        <Field
          label="Description (optional)"
          htmlFor={descriptionId}
          error={errorFor("description")}
        >
          <textarea
            id={descriptionId}
            value={description}
            onChange={(event) => setDescription(event.target.value.toLowerCase())}
            rows={3}
            maxLength={1000}
            placeholder="anything everyone should know?"
            className="ios-input ios-textarea"
          />
        </Field>

        <Field label="Length" htmlFor={durationId} error={errorFor("durationMinutes")}>
          <select
            id={durationId}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            className="ios-input"
          >
            {DURATIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {durationLabel(minutes)}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title="When?">
        <fieldset className="timing-fieldset">
          <legend className="sr-only">When should the first plan happen?</legend>
          <div className="timing-options">
            {(
              [
                ["asap", "asap"],
                ["range", "date range"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="timing-option">
                <input
                  type="radio"
                  name="timing"
                  value={value}
                  checked={timingMode === value}
                  onChange={() => setTimingMode(value)}
                  className="sr-only"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {timingMode === "range" ? (
          <div className="ios-pair">
            <Field label="earliest" htmlFor={startId} error={errorFor("startDate")}>
              <input
                id={startId}
                type="date"
                value={customStartDate}
                min={defaultStartDate}
                onChange={(event) => {
                  const nextStart = event.target.value;
                  setStartDate(nextStart);
                  if (customEndDate < nextStart) setEndDate(nextStart);
                }}
                className="ios-input"
              />
            </Field>
            <Field label="latest" htmlFor={endId} error={errorFor("endDate")}>
              <input
                id={endId}
                type="date"
                value={customEndDate}
                min={customStartDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="ios-input"
              />
            </Field>
          </div>
        ) : null}

      </Card>

      <Card title="Your information">
        <Field label="Your name" htmlFor={nameId} error={errorFor("organizerName")}>
          <input
            id={nameId}
            type="text"
            value={organizerName}
            onChange={(event) => setOrganizerName(event.target.value.toLowerCase())}
            autoComplete="name"
            placeholder="jane smith"
            className="ios-input"
          />
        </Field>
        <Field label="Your email" htmlFor={emailId} error={errorFor("organizerEmail")}>
          <input
            id={emailId}
            type="email"
            value={organizerEmail}
            onChange={(event) => setOrganizerEmail(event.target.value.toLowerCase())}
            autoComplete="email"
            placeholder="jane@example.com"
            className="ios-input"
          />
        </Field>
      </Card>

      <Card title="Who's coming">
        <span id={participantsLabelId} className="sr-only">
          Participant email addresses
        </span>
        <ParticipantChips
          emails={participantEmails}
          onChange={setParticipantEmails}
          labelledBy={participantsLabelId}
        />
        {errorFor("participantEmails") && (
          <p className="ios-field-error">{errorFor("participantEmails")}</p>
        )}
      </Card>

      <div aria-hidden="true" className="hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value.toLowerCase())}
        />
      </div>

      {error && (
        <div role="alert" className="ios-error-banner">
          {error}
        </div>
      )}

      <button type="submit" disabled={!isValid || loading} className="ios-primary-button">
        {loading ? "Starting the plan…" : "Start the plan"}
      </button>

      <p className="ios-footnote">
        You&apos;ll connect your own calendar next. Invitations go out after that.
      </p>
    </form>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ios-card">
      <h2>{title}</h2>
      <div className="ios-card-content">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ios-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error && <p className="ios-field-error">{error}</p>}
    </div>
  );
}
