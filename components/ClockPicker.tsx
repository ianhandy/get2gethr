"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ClockPickerProps {
  value: string; // "HH:MM" 24h
  onChange: (value: string) => void;
  label?: string;
}

const SIZE = 220;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = 88;

function polarToXY(angleDeg: number, r: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function xyToAngle(x: number, y: number): number {
  const angle = (Math.atan2(y - CY, x - CX) * 180) / Math.PI + 90;
  return ((angle % 360) + 360) % 360;
}

function to12h(h24: number): { h: number; isPM: boolean } {
  const isPM = h24 >= 12;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return { h, isPM };
}

export default function ClockPicker({ value, onChange, label }: ClockPickerProps) {
  const [parts] = [value.split(":")];
  const h24 = parseInt(parts[0] ?? "9", 10) || 9;
  const min = parseInt(parts[1] ?? "0", 10) || 0;
  const { h, isPM } = to12h(h24);

  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const svgRef = useRef<SVGSVGElement>(null);

  const hourAngle = (h % 12) * 30;      // 360/12
  const minuteAngle = min * 6;           // 360/60

  // Hand tip positions
  const hourTip = polarToXY(hourAngle, RADIUS * 0.55);
  const minuteTip = polarToXY(minuteAngle, RADIUS * 0.8);

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const svgScale = SIZE / rect.width;
      const x = (e.clientX - rect.left) * svgScale;
      const y = (e.clientY - rect.top) * svgScale;
      const angle = xyToAngle(x, y);

      if (mode === "hour") {
        const pickedH12 = Math.round(angle / 30) % 12 || 12;
        let newH24 = isPM ? (pickedH12 === 12 ? 12 : pickedH12 + 12) : pickedH12 === 12 ? 0 : pickedH12;
        if (newH24 === 24) newH24 = 12;
        const padded = String(newH24).padStart(2, "0");
        onChange(`${padded}:${String(min).padStart(2, "0")}`);
        setMode("minute");
      } else {
        const pickedMin = Math.round(angle / 6) % 60;
        onChange(`${String(h24).padStart(2, "0")}:${String(pickedMin).padStart(2, "0")}`);
        setMode("hour");
      }
    },
    [mode, h24, min, isPM, onChange]
  );

  function toggleAMPM() {
    const newH24 = isPM ? (h === 12 ? 0 : h) : h === 12 ? 12 : h + 12;
    onChange(`${String(newH24).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }

  // Hour tick positions
  const hourTicks = Array.from({ length: 12 }, (_, i) => {
    const angle = i * 30;
    const pos = polarToXY(angle, RADIUS * 0.82);
    const numeral = i === 0 ? 12 : i;
    return { angle, pos, numeral };
  });

  // Minute tick positions (every 5 min)
  const minuteTicks = Array.from({ length: 12 }, (_, i) => {
    const angle = i * 30;
    const inner = polarToXY(angle, RADIUS * 0.92);
    const outer = polarToXY(angle, RADIUS * 0.98);
    return { inner, outer };
  });

  const displayTime = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")} ${isPM ? "PM" : "AM"}`;

  return (
    <div className="flex flex-col items-center gap-3">
      {label && (
        <span className="text-sm font-medium" style={{ color: "var(--color-muted)" }}>
          {label}
        </span>
      )}

      {/* Digital readout */}
      <div
        className="font-display text-2xl font-bold tracking-wide"
        style={{ color: "var(--color-primary)" }}
      >
        {displayTime}
      </div>

      {/* Mode indicator */}
      <div className="flex gap-2 text-xs">
        <button
          onClick={() => setMode("hour")}
          className="rounded-full px-3 py-1 transition-all"
          style={{
            background: mode === "hour" ? "var(--color-primary)" : "var(--color-border)",
            color: mode === "hour" ? "#fff" : "var(--color-muted)",
          }}
        >
          Hour
        </button>
        <button
          onClick={() => setMode("minute")}
          className="rounded-full px-3 py-1 transition-all"
          style={{
            background: mode === "minute" ? "var(--color-primary)" : "var(--color-border)",
            color: mode === "minute" ? "#fff" : "var(--color-muted)",
          }}
        >
          Minute
        </button>
      </div>

      {/* Clock SVG */}
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onClick={handleSvgClick}
        className="cursor-pointer select-none"
        style={{ maxWidth: "100%" }}
      >
        {/* Clock face */}
        <circle
          cx={CX}
          cy={CY}
          r={RADIUS}
          fill="var(--color-surface)"
          stroke="var(--color-border)"
          strokeWidth="2"
        />

        {/* Minute tick marks */}
        {minuteTicks.map((t, i) => (
          <line
            key={i}
            x1={t.inner.x}
            y1={t.inner.y}
            x2={t.outer.x}
            y2={t.outer.y}
            stroke="var(--color-border)"
            strokeWidth="1.5"
          />
        ))}

        {/* Hour numerals */}
        {hourTicks.map(({ pos, numeral }) => (
          <text
            key={numeral}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="11"
            fontFamily="inherit"
            fontWeight="500"
            fill={
              (mode === "hour" && numeral === h) || (mode === "minute" && Math.round(min / 5) % 12 === (numeral % 12))
                ? "var(--color-accent-a)"
                : "var(--color-muted)"
            }
          >
            {numeral}
          </text>
        ))}

        {/* Hour hand */}
        <motion.line
          x1={CX}
          y1={CY}
          x2={hourTip.x}
          y2={hourTip.y}
          stroke="var(--color-accent-a)"
          strokeWidth="4"
          strokeLinecap="round"
          animate={{ x2: hourTip.x, y2: hourTip.y }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />

        {/* Minute hand */}
        <motion.line
          x1={CX}
          y1={CY}
          x2={minuteTip.x}
          y2={minuteTip.y}
          stroke="var(--color-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          animate={{ x2: minuteTip.x, y2: minuteTip.y }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />

        {/* Center dot */}
        <circle cx={CX} cy={CY} r="4" fill="var(--color-primary)" />

        {/* Mode ring highlight */}
        <AnimatePresence>
          {mode === "hour" && (
            <motion.circle
              cx={CX}
              cy={CY}
              r={RADIUS * 0.58}
              fill="none"
              stroke="var(--color-accent-a)"
              strokeWidth="1"
              strokeDasharray="4 4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
            />
          )}
          {mode === "minute" && (
            <motion.circle
              cx={CX}
              cy={CY}
              r={RADIUS * 0.84}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="1"
              strokeDasharray="4 4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
      </svg>

      {/* AM / PM toggle */}
      <div
        className="flex rounded-full p-1 text-sm font-medium"
        style={{ background: "var(--color-border)" }}
      >
        <button
          onClick={!isPM ? undefined : toggleAMPM}
          className="rounded-full px-4 py-1 transition-all"
          style={{
            background: !isPM ? "var(--color-primary)" : "transparent",
            color: !isPM ? "#fff" : "var(--color-muted)",
          }}
        >
          AM
        </button>
        <button
          onClick={isPM ? undefined : toggleAMPM}
          className="rounded-full px-4 py-1 transition-all"
          style={{
            background: isPM ? "var(--color-primary)" : "transparent",
            color: isPM ? "#fff" : "var(--color-muted)",
          }}
        >
          PM
        </button>
      </div>
    </div>
  );
}
