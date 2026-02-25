"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

interface InviteData {
  participant: { id: string; email: string; name: string | null; status: "pending" | "joined" | "declined" };
  event: {
    id: string; title: string; description: string | null;
    initiatorName: string; initiatorEmail: string;
    dateRangeStart: number; dateRangeEnd: number;
    durationMinutes: number; timezone: string; status: string;
  };
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const [data, setData] = useState<InviteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);

  const justJoined   = searchParams.get("joined")  === "true";
  const alreadyJoined = searchParams.get("already") === "joined";
  const oauthError   = searchParams.get("error");

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Failed to load invitation."));
  }, [token]);

  async function handleDecline() {
    setDeclining(true);
    try {
      const res = await fetch(`/api/invite/${token}/decline`, { method: "POST" });
      if (res.ok) setDeclined(true);
      else setError("Failed to decline. You may have already responded.");
    } finally { setDeclining(false); }
  }

  if (error) return (
    <div className="rounded-2xl border p-8 text-center" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
      <p className="text-sm" style={{ color: "var(--color-accent-a)" }}>{error}</p>
    </div>
  );

  if (!data) return (
    <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-muted)" }}>
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      Loading invitation…
    </div>
  );

  const { participant, event } = data;
  const startFmt = format(new Date(event.dateRangeStart * 1000), "MMM d, yyyy");
  const endFmt   = format(new Date(event.dateRangeEnd   * 1000), "MMM d, yyyy");

  if (participant.status === "joined" || justJoined || alreadyJoined) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl border p-10 text-center"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-2xl"
          style={{ background: "color-mix(in srgb, var(--color-accent-c) 20%, transparent)" }}>
          ✓
        </div>
        <h1 className="font-display mb-2 text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
          You&apos;re in!
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Calendar connected for <strong>{event.title}</strong>. We&apos;ll email you at{" "}
          <strong>{participant.email}</strong> when a time is proposed.
        </p>
      </motion.div>
    );
  }

  if (participant.status === "declined" || declined) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="rounded-2xl border p-10 text-center"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h1 className="font-display mb-2 text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
          Invitation Declined
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          You&apos;ve declined the invitation to <strong>{event.title}</strong>.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-muted)" }}>
          Invitation from {event.initiatorName}
        </p>
        <h1 className="font-display text-3xl font-bold" style={{ color: "var(--color-primary)" }}>
          {event.title}
        </h1>
        {event.description && (
          <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>{event.description}</p>
        )}
      </motion.div>

      {/* Event details card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="rounded-2xl border p-6 space-y-3"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        {/* Calendar decoration */}
        <div className="flex items-start justify-between">
          <div className="space-y-3 flex-1">
            <InfoRow label="Invited as" value={participant.email} />
            <InfoRow label="Date window" value={`${startFmt} – ${endFmt}`} />
            <InfoRow label="Duration" value={`${event.durationMinutes} minutes`} />
            <InfoRow label="Timezone" value={event.timezone} />
          </div>
          <CalendarIllustration />
        </div>
      </motion.div>

      {oauthError && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: "#FFF5F3", color: "var(--color-accent-a)", border: "1px solid #FDDDD6" }}>
          There was a problem connecting your Google Calendar. Please try again.
        </div>
      )}

      {/* Connect button */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
        <div className="rounded-2xl border p-6" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
          <h2 className="font-display mb-2 text-lg font-bold" style={{ color: "var(--color-primary)" }}>
            Connect Your Calendar
          </h2>
          <p className="mb-5 text-sm" style={{ color: "var(--color-muted)" }}>
            We only request <strong>read-only free/busy access</strong> — we cannot see your event details.
          </p>
          <motion.a
            href={`/api/auth/google?token=${token}`}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="inline-flex items-center gap-3 rounded-2xl px-6 py-3.5 text-sm font-semibold text-white shadow-md transition-shadow hover:shadow-lg"
            style={{ background: "var(--color-accent-a)" }}
          >
            <GoogleIcon />
            Connect Google Calendar
          </motion.a>
        </div>
      </motion.div>

      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="text-center"
        >
          <button
            onClick={handleDecline} disabled={declining}
            className="text-sm transition-colors hover:underline disabled:opacity-50"
            style={{ color: "var(--color-muted)" }}
          >
            {declining ? "Declining…" : "I can't make it — decline invitation"}
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <span className="w-24 flex-shrink-0" style={{ color: "var(--color-muted)" }}>{label}</span>
      <span className="font-medium" style={{ color: "var(--color-primary)" }}>{value}</span>
    </div>
  );
}

function CalendarIllustration() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="12" width="56" height="48" rx="6" fill="var(--color-accent-b)" opacity="0.25" />
      <rect x="4" y="12" width="56" height="16" rx="6" fill="var(--color-accent-b)" opacity="0.5" />
      <rect x="4" y="24" width="56" height="4" fill="var(--color-accent-b)" opacity="0.5" />
      <line x1="20" y1="4" x2="20" y2="20" stroke="var(--color-accent-a)" strokeWidth="3" strokeLinecap="round" />
      <line x1="44" y1="4" x2="44" y2="20" stroke="var(--color-accent-a)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="22" cy="42" r="4" fill="var(--color-accent-c)" />
      <circle cx="32" cy="42" r="4" fill="var(--color-accent-a)" opacity="0.5" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
