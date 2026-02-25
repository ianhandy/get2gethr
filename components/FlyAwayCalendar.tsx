"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface FlyAwayCalendarProps {
  onComplete: () => void;
}

// Stable random values per page (seeded by index so they're the same on each render)
const PAGE_CONFIGS = [
  { x: -720, y: -680, rotate: -145, delay: 0 },
  { x: 650, y: -590, rotate: 120, delay: 0.08 },
  { x: -380, y: -820, rotate: -200, delay: 0.16 },
  { x: 800, y: -720, rotate: 175, delay: 0.06 },
  { x: 120, y: -900, rotate: -80, delay: 0.12 },
];

const DURATION = 0.75;
const TOTAL_MS = (0.16 + DURATION + 0.05) * 1000; // last delay + duration + buffer

export default function FlyAwayCalendar({ onComplete }: FlyAwayCalendarProps) {
  const calledRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!calledRef.current) {
        calledRef.current = true;
        onComplete();
      }
    }, TOTAL_MS);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "var(--color-bg)" }}
    >
      {/* Background success message */}
      <motion.div
        className="absolute flex flex-col items-center gap-3"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <div
          className="font-display text-4xl font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          Finding your time!
        </div>
        <div className="text-lg" style={{ color: "var(--color-muted)" }}>
          Invites are on their way…
        </div>
        <motion.div
          className="mt-4 h-1 w-32 rounded-full"
          style={{ background: "var(--color-accent-c)" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
        />
      </motion.div>

      {/* Flying calendar pages */}
      {PAGE_CONFIGS.map((cfg, i) => (
        <motion.div
          key={i}
          className="absolute rounded-lg border-2"
          style={{
            width: 80,
            height: 96,
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{
            x: cfg.x,
            y: cfg.y,
            rotate: cfg.rotate,
            opacity: 0,
          }}
          transition={{
            duration: DURATION,
            delay: cfg.delay,
            ease: [0.32, 0, 0.67, 0],
          }}
        >
          {/* Mini calendar content */}
          <div
            className="flex h-7 items-center justify-center rounded-t text-xs font-semibold text-white"
            style={{ background: "var(--color-accent-a)" }}
          >
            {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][i % 7]}
          </div>
          <div
            className="font-display flex h-full items-center justify-center pb-4 text-3xl font-bold"
            style={{ color: "var(--color-primary)" }}
          >
            {10 + i * 3}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
