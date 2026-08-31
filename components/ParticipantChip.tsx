"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

interface ParticipantChipsProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  /** Associates the field with a visible label owned by the parent form. */
  labelledBy?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ParticipantChips({
  emails,
  onChange,
  labelledBy,
}: ParticipantChipsProps) {
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const statusId = useId();
  const hintId = useId();
  const reduceMotion = useReducedMotion();

  function addEmail(raw: string) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError(`${trimmed} is not a valid email address`);
      return;
    }
    if (emails.includes(trimmed)) {
      setError(`${trimmed} has already been added`);
      setInputValue("");
      return;
    }
    setError(null);
    onChange([...emails, trimmed]);
    setInputValue("");
  }

  function removeEmail(email: string) {
    setError(null);
    onChange(emails.filter((existing) => existing !== email));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      addEmail(inputValue);
    } else if (event.key === "Backspace" && inputValue === "" && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
    }
  }

  const chipMotion = reduceMotion
    ? {}
    : {
        initial: { scale: 0.9, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        exit: { scale: 0.9, opacity: 0 },
        transition: { type: "spring" as const, stiffness: 400, damping: 25 },
      };

  return (
    <div className="flex flex-col gap-2">
      <p id={hintId} className="text-sm" style={{ color: "var(--color-muted)" }}>
        Type an email and press Enter to add it. Backspace removes the last one.
      </p>

      {emails.length > 0 && (
        <ul className="flex flex-wrap gap-2 p-0" aria-label="People invited">
          <AnimatePresence mode="popLayout" initial={false}>
            {emails.map((email) => (
              <motion.li
                key={email}
                layout={!reduceMotion}
                {...chipMotion}
                className="flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-sm font-medium"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-accent-c) 15%, transparent)",
                  color: "var(--color-primary)",
                  border:
                    "1px solid color-mix(in srgb, var(--color-accent-c) 40%, transparent)",
                }}
              >
                <span className="break-all">{email}</span>
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  // A generic "×" announces as nothing useful when a screen
                  // reader lists every remove button on the page.
                  aria-label={`Remove ${email}`}
                  className="flex items-center justify-center rounded-full text-base leading-none transition-colors hover:bg-black/10 focus:outline-none focus:ring-2 [--tw-ring-color:var(--color-accent-c)]"
                  style={{ minWidth: "44px", minHeight: "44px" }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <div
        className="flex min-h-[52px] flex-wrap items-center gap-2 rounded-xl border px-3 py-2 transition-all"
        style={{
          background: "var(--color-surface)",
          borderColor: error ? "var(--color-accent-a)" : "var(--color-border)",
        }}
      >
        <input
          id={inputId}
          type="email"
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => addEmail(inputValue)}
          placeholder="alex@example.com"
          aria-labelledby={labelledBy}
          aria-describedby={`${hintId} ${statusId}`}
          aria-invalid={error ? true : undefined}
          className="min-w-[160px] flex-1 bg-transparent text-base outline-none"
          style={{ color: "var(--color-primary)", minHeight: "44px" }}
        />
      </div>

      {/* One live region carries both the running count and any error, so a
          screen-reader user hears the result of adding without moving focus. */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className="text-xs"
        style={{ color: error ? "var(--color-accent-a)" : "var(--color-muted)" }}
      >
        {error ??
          (emails.length === 0
            ? "No one added yet"
            : `${emails.length} ${emails.length === 1 ? "person" : "people"} added`)}
      </p>
    </div>
  );
}
