import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support — get2gethr",
  description: "Help with get2gethr, and how to get your data deleted.",
};

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@get2gethr.app";

/** App Store review requires a working support URL and contact route. */
export default function SupportPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-display text-3xl font-bold" style={{ color: "var(--color-primary)" }}>
        Support
      </h1>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: "var(--color-accent-a)" }}>
          {SUPPORT_EMAIL}
        </a>{" "}
        and we&rsquo;ll get back to you. Include the event link if your question is about a
        specific meeting.
      </p>

      <Faq question="I lost my organizer link">
        The organizer link contains a credential that isn&rsquo;t in any invitation email,
        so we can&rsquo;t reconstruct it for you. Check your browser history for a
        <code> /events/</code> address. If you can&rsquo;t find it, email us from the
        organizer address and we can cancel the event so you can start again.
      </Faq>

      <Faq question="It says my calendar belongs to a different address">
        Invitations are bound to the address they were sent to, so a forwarded invitation
        can&rsquo;t connect someone else&rsquo;s calendar. Sign out of the other account,
        or ask the organizer to invite the address you actually use.
      </Faq>

      <Faq question="What does get2gethr see in my calendar?">
        Only the start and end times of blocks when you&rsquo;re busy. Not titles, guests,
        locations, or notes. See the{" "}
        <Link href="/privacy" className="underline" style={{ color: "var(--color-accent-a)" }}>
          privacy page
        </Link>
        .
      </Faq>

      <Faq question="How do I disconnect my calendar?">
        Revoke get2gethr&rsquo;s access from your calendar provider&rsquo;s account
        settings at any time. Scheduling for events you joined will pause and the organizer
        will be told a reconnection is needed.
      </Faq>

      <Faq question="Delete my data">
        Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: "var(--color-accent-a)" }}>
          {SUPPORT_EMAIL}
        </a>{" "}
        from the address you want removed. We action deletion requests within 30 days.
      </Faq>
    </article>
  );
}

function Faq({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-lg font-bold" style={{ color: "var(--color-primary)" }}>
        {question}
      </h2>
      <p className="text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
        {children}
      </p>
    </section>
  );
}
