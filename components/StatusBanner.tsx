"use client";

import { motion } from "framer-motion";

type BannerVariant = "blue" | "green" | "red" | "purple" | "amber";

const variantStyles: Record<BannerVariant, { stripe: string; bg: string; text: string }> = {
  blue:   { stripe: "#60A5FA", bg: "#EFF6FF", text: "#1E40AF" },
  green:  { stripe: "var(--color-accent-c)", bg: "#F0FDF4", text: "#166534" },
  red:    { stripe: "var(--color-accent-a)", bg: "#FFF5F3", text: "#9B1C1C" },
  purple: { stripe: "#A78BFA", bg: "#F5F3FF", text: "#5B21B6" },
  amber:  { stripe: "var(--color-accent-b)", bg: "#FFFBEB", text: "#92400E" },
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
      <div className="flex items-center gap-3 px-4 py-3 text-sm" style={{ color: s.text }}>
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
