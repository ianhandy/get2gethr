"use client";

import { motion } from "framer-motion";

type BannerVariant = "blue" | "green" | "red" | "purple" | "amber";

const variantStyles: Record<BannerVariant, { stripe: string; bg: string }> = {
  blue: {
    stripe: "#60A5FA",
    bg: "color-mix(in srgb, #60A5FA 15%, var(--color-surface))",
  },
  green: {
    stripe: "var(--color-accent-c)",
    bg: "color-mix(in srgb, var(--color-accent-c) 18%, var(--color-surface))",
  },
  red: {
    stripe: "var(--color-accent-a)",
    bg: "color-mix(in srgb, var(--color-accent-a) 14%, var(--color-surface))",
  },
  purple: {
    stripe: "#A78BFA",
    bg: "color-mix(in srgb, #A78BFA 14%, var(--color-surface))",
  },
  amber: {
    stripe: "var(--color-accent-b)",
    bg: "color-mix(in srgb, var(--color-accent-b) 18%, var(--color-surface))",
  },
};

interface StatusBannerProps {
  variant: BannerVariant;
  children: React.ReactNode;
  pulse?: boolean;
}

export default function StatusBanner({ variant, children, pulse }: StatusBannerProps) {
  const s = variantStyles[variant];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex overflow-hidden rounded-xl"
      style={{ background: s.bg }}
    >
      <div
        className="w-1 flex-shrink-0"
        style={{ background: s.stripe }}
      />
      <div
        className="flex items-center gap-3 px-4 py-3 text-sm"
        style={{ color: "var(--color-primary)" }}
      >
        {pulse && (
          <span
            className="inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full"
            style={{ background: s.stripe }}
          />
        )}
        <span>{children}</span>
      </div>
    </motion.div>
  );
}
