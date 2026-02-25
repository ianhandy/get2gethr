import type { Metadata } from "next";
import { Playfair_Display, DM_Sans } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-playfair",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Group Scheduler",
  description: "Find a time that works for everyone",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmSans.variable}`}>
      <body className="min-h-screen antialiased" style={{ background: "var(--color-bg)" }}>
        <header
          className="sticky top-0 z-40 px-6 py-4"
          style={{
            background: "var(--color-bg)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <a
              href="/"
              className="font-display text-xl font-bold transition-colors"
              style={{ color: "var(--color-primary)" }}
            >
              Group{" "}
              <span style={{ color: "var(--color-accent-a)" }}>Scheduler</span>
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
