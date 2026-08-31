import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — get2gethr",
  description: "The terms for using get2gethr.",
};

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@get2gethr.app";

export default function TermsPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-display text-3xl font-bold" style={{ color: "var(--color-primary)" }}>
        Terms of use
      </h1>

      <Section title="The service">
        <p>
          get2gethr reads free/busy information from calendars people connect, proposes a
          meeting time that suits everyone, and writes the agreed meeting to the
          organizer&rsquo;s calendar. It is provided as-is, without warranty.
        </p>
      </Section>

      <Section title="Your responsibilities">
        <ul className="list-disc space-y-2 pl-5">
          <li>Only invite people who expect to hear from you. Do not use it to send bulk or unsolicited mail.</li>
          <li>Connect only calendars you are entitled to connect.</li>
          <li>Do not attempt to access events or invitations that are not yours.</li>
        </ul>
      </Section>

      <Section title="Availability and accuracy">
        <p>
          Scheduling depends on third-party calendar providers. If a provider is
          unavailable or an authorization is revoked, scheduling may pause. Always check a
          confirmed meeting in your own calendar; get2gethr is not liable for missed
          meetings or scheduling conflicts.
        </p>
      </Section>

      <Section title="Ending use">
        <p>
          You can cancel an event at any time from the organizer page, and disconnect a
          calendar at any time from your provider. We may suspend accounts or events that
          breach these terms.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Reach us at{" "}
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
