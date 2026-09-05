"use client";

import { useId, useMemo } from "react";

interface TimezoneFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

/**
 * A short, curated list used only as a fallback.
 *
 * The previous fixed 14-entry list excluded most of the world and truncated
 * visibly at 320px. Modern runtimes can enumerate every zone they support, so
 * this is only reached on an older browser.
 */
const FALLBACK_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function supportedTimeZones(): string[] {
  const withSupport = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  try {
    const zones = withSupport.supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones;
  } catch {
    // fall through to the curated list
  }
  return FALLBACK_ZONES;
}

/** The zone's current UTC offset, for a label people can sanity-check. */
function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * Timezone selection backed by a datalist.
 *
 * A native `<input list>` gives type-ahead over the full IANA set while
 * remaining a plain text input for keyboard and screen-reader users — no
 * custom combobox semantics to get wrong. The value is validated server-side
 * regardless.
 */
export default function TimezoneField({ value, onChange, label }: TimezoneFieldProps) {
  const inputId = useId();
  const listId = useId();
  const hintId = useId();

  const zones = useMemo(() => supportedTimeZones(), []);
  const offset = useMemo(() => offsetLabel(value), [value]);
  const known = useMemo(() => zones.includes(value), [zones, value]);

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium"
        style={{ color: "var(--color-primary)" }}
      >
        {label}
        <span className="ml-1" style={{ color: "var(--color-accent-a)" }} aria-hidden="true">
          *
        </span>
      </label>

      <input
        id={inputId}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hintId}
        aria-invalid={known ? undefined : true}
        className="w-full rounded-xl border px-3.5 text-base transition-colors focus:outline-none focus:ring-2 [--tw-ring-color:var(--color-accent-c)] [background:var(--color-surface)] [border-color:var(--color-border)] [color:var(--color-primary)]"
        style={{ minHeight: "44px" }}
      />

      <datalist id={listId}>
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <p id={hintId} className="text-xs" style={{ color: "var(--color-muted)" }}>
        {known
          ? `All times are shown in ${value}${offset ? ` (${offset})` : ""}.`
          : "Start typing a city or region, for example Europe/Berlin."}
      </p>
    </div>
  );
}
