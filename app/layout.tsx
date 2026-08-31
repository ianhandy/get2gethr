import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Playfair_Display, DM_Sans } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-playfair",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "get2gethr — Find the perfect time to meet",
  description:
    "Automated group scheduling. Connect calendars, find common availability, confirm a time — no back-and-forth.",
  openGraph: {
    title: "get2gethr",
    description:
      "Automated group scheduling. Connect calendars, find common availability, confirm a time.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Never block zoom: pinch-to-zoom is a primary accessibility affordance.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmSans.variable}`}>
      <body className="min-h-screen antialiased" style={{ background: "var(--color-bg)" }}>
        {/* First stop for a keyboard user, so the form is one Tab away. */}
        <a href="#main" className="skip-link">
          Skip to main content
        </a>

        <header
          className="sticky top-0 z-40 px-6 py-4"
          style={{
            background: "var(--color-bg)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <Link
              href="/"
              className="font-display flex items-center text-xl font-bold transition-colors"
              // 44px keeps the home link a comfortable target on a phone.
              style={{ color: "var(--color-primary)", minHeight: "44px" }}
            >
              get2<span style={{ color: "var(--color-accent-a)" }}>gethr</span>
            </Link>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-2xl px-6 py-10">
          {children}
        </main>

        <footer className="mx-auto max-w-2xl px-6 pb-10 text-sm">
          {/* Standalone navigation links, so each gets a full 44px target
              rather than relying on the inline-text exemption. */}
          <nav aria-label="Legal and support" className="flex flex-wrap gap-x-4">
            {[
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
              { href: "/support", label: "Support" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center px-1"
                style={{ color: "var(--color-muted)", minHeight: "44px" }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </footer>
      </body>
    </html>
  );
}
