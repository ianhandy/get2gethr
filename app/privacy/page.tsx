import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy | find·a·day",
  description: "What find·a·day collects, why, and how to have it deleted.",
};

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@finda.day";

/**
 * Written to match what the code actually does. App Store review and the
 * OAuth consent screen both require a reachable, accurate policy URL, and an
 * aspirational one is worse than none.
 */
export default function PrivacyPage() {
  return (
    <article className="prose-get2gethr space-y-6">
      <h1 className="font-display text-3xl font-bold" style={{ color: "var(--color-primary)" }}>
        Privacy
      </h1>
      <p style={{ color: "var(--color-muted)" }}>
        find·a·day finds a time that works for a group. To do that it needs to know
        when people are busy, and nothing else.
      </p>

      <Section title="What we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Event details you enter:</strong> title, optional description, date
            window, duration, weekly availability, preferences, and timezone.
          </li>
          <li>
            <strong>Email addresses:</strong> yours as organizer, and the ones you invite,
            so we can send invitations and calendar invites.
          </li>
          <li>
            <strong>Calendar busy times:</strong> the start and end times of blocks when a
            connected calendar is busy, or the times you review and confirm from a
            photographed schedule. We do not read event titles, guests, locations,
            attachments, or notes.
          </li>
          <li>
            <strong>Calendar connection metadata:</strong> which provider and account is
            connected, which calendars contribute availability, and which calendar the
            confirmed meeting is written to.
          </li>
          <li>
            <strong>Operational data:</strong> email delivery outcomes, and a one-way hash
            of the network address that created an event, used only for rate limiting.
            The address itself is never stored.
          </li>
        </ul>
      </Section>

      <Section title="What we do not collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>The contents, titles, or attendees of your existing calendar events.</li>
          <li>
            Schedule photos or recognized text. In the iOS app, both remain on your
            device and are discarded after you review the resulting busy times.
          </li>
          <li>Contacts, files, location, or advertising identifiers.</li>
          <li>Anything used for advertising or sold to anyone.</li>
        </ul>
      </Section>

      <Section title="Who else is involved">
        <p>
          Events are read from and written to your calendar provider, Google,
          Microsoft, Apple, or Exchange, with your explicit authorization, which you can
          revoke at any time from that provider&rsquo;s account settings. Email is
          delivered through Amazon Simple Email Service. Data is stored in Turso. Each
          of these processes data only to provide the service.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Event data, participant addresses, and calendar connections are kept while an
          event is active and for 90 days afterwards, then deleted. Disconnecting a
          calendar removes its stored authorization immediately. You can also revoke the
          app&rsquo;s consent from your calendar provider&rsquo;s account settings.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          Cancelling an event from the organizer page stops all processing for it. To have
          an event and its associated data deleted outright, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: "var(--color-accent-a)" }}>
            {SUPPORT_EMAIL}
          </a>{" "}
          from the organizer address, or from any invited address to remove yourself. We
          action deletion requests within 30 days.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Calendar authorizations are encrypted at rest with authenticated encryption.
          Invitation links are unguessable capabilities; the organizer&rsquo;s management
          view requires a separate credential that is never included in an invitation.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about any of this go to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: "var(--color-accent-a)" }}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl font-bold" style={{ color: "var(--color-primary)" }}>
        {title}
      </h2>
      <div className="text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
        {children}
      </div>
    </section>
  );
}
