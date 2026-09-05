"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface TimeFieldProps {
  value: string; // "HH:mm", 24-hour
  onChange: (value: string) => void;
  label: string;
  /** Extra context announced with the field, e.g. the timezone. */
  hint?: string;
}

const SIZE = 180;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = 72;

function polar(angleDeg: number, r: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function parseTime(value: string): { hours: number; minutes: number } {
  const [rawHours, rawMinutes] = value.split(":");
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  return {
    hours: Number.isFinite(hours) ? Math.min(23, Math.max(0, hours)) : 9,
    minutes: Number.isFinite(minutes) ? Math.min(59, Math.max(0, minutes)) : 0,
  };
}

function speak(value: string): string {
  const { hours, minutes } = parseTime(value);
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/**
 * A time input with an analog clock beside it.
 *
 * The native `<input type="time">` is the control: it is keyboard operable,
 * announces itself correctly, respects the platform's 12/24-hour convention,
 * and takes one line instead of 300 pixels of vertical space.
 *
 * The clock stays because it is a large part of the product's character, but
 * it is now a read-only reflection of the value — `aria-hidden`, no pointer
 * handlers. A control that only responds to a mouse is worse than a picture,
 * because assistive technology cannot tell the difference until it fails.
 */
export default function TimeField({ value, onChange, label, hint }: TimeFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const [showClock, setShowClock] = useState(false);
  const reduceMotion = useReducedMotion();

  const { hours, minutes } = parseTime(value);
  const hourTip = polar(((hours % 12) + minutes / 60) * 30, RADIUS * 0.55);
  const minuteTip = polar(minutes * 6, RADIUS * 0.8);

  const spring = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 300, damping: 30 };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className="text-sm font-medium"
        style={{ color: "var(--color-primary)" }}
      >
        {label}
      </label>

      <input
        id={inputId}
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? hintId : undefined}
        required
        // 44px minimum height keeps the tap target usable on a phone.
        className="w-full rounded-xl border px-3.5 text-base transition-colors focus:outline-none focus:ring-2 [--tw-ring-color:var(--color-accent-c)] [background:var(--color-surface)] [border-color:var(--color-border)] [color:var(--color-primary)]"
        style={{ minHeight: "44px" }}
      />

      {hint && (
        <p id={hintId} className="text-xs" style={{ color: "var(--color-muted)" }}>
          {hint}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowClock((open) => !open)}
        aria-expanded={showClock}
        className="self-start rounded-lg px-2 py-2 text-xs underline-offset-2 hover:underline focus:outline-none focus:ring-2 [--tw-ring-color:var(--color-accent-c)]"
        style={{ color: "var(--color-muted)", minHeight: "44px" }}
      >
        {showClock ? "Hide clock" : "Show clock"}
      </button>

      {showClock && (
        <div className="flex flex-col items-center gap-1">
          {/* Decorative: the input above is the accessible source of truth. */}
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            aria-hidden="true"
            focusable="false"
            className="select-none"
            style={{ maxWidth: "100%" }}
          >
            <circle
              cx={CX}
              cy={CY}
              r={RADIUS}
              fill="var(--color-surface)"
              stroke="var(--color-border)"
              strokeWidth="2"
            />
            {Array.from({ length: 12 }, (_, i) => {
              const position = polar(i * 30, RADIUS * 0.82);
              const numeral = i === 0 ? 12 : i;
              return (
                <text
                  key={numeral}
                  x={position.x}
                  y={position.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="11"
                  fontWeight="500"
                  fill="var(--color-muted)"
                >
                  {numeral}
                </text>
              );
            })}
            <motion.line
              x1={CX}
              y1={CY}
              stroke="var(--color-accent-a)"
              strokeWidth="4"
              strokeLinecap="round"
              animate={{ x2: hourTip.x, y2: hourTip.y }}
              initial={{ x2: hourTip.x, y2: hourTip.y }}
              transition={spring}
            />
            <motion.line
              x1={CX}
              y1={CY}
              stroke="var(--color-primary)"
              strokeWidth="2.5"
              strokeLinecap="round"
              animate={{ x2: minuteTip.x, y2: minuteTip.y }}
              initial={{ x2: minuteTip.x, y2: minuteTip.y }}
              transition={spring}
            />
            <circle cx={CX} cy={CY} r="4" fill="var(--color-primary)" />
          </svg>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            {speak(value)}
          </p>
        </div>
      )}
    </div>
  );
}
