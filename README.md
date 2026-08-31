# get2gethr

Automated group scheduling. Create an event, invite people, everyone connects a
calendar, and the app finds a time that works — then writes it to the calendar.

## How it works

1. **Create an event** — a date window, a duration, and working hours.
2. **Connect your calendar** — the organizer goes first, because their own
   availability has to be part of the search. Invitations go out after that.
3. **Everyone connects** — each person shares free/busy only. Never event
   titles, guests, or notes.
4. **A time is proposed** — the highest-ranked slot where everyone is free,
   rechecked against live availability before it is proposed.
5. **Everyone confirms** — availability is rechecked one last time, the meeting
   is written to the organizer's calendar exactly once, and everyone gets a
   confirmation with an ICS attachment.

If someone declines, the next slot is proposed. If nobody answers, the organizer
can remind, proceed without them, or cancel.

## Stack

| Layer | Technology |
|-------|-----------|
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| iOS | SwiftUI, iOS 17+ |
| Database | Turso (libSQL) via Drizzle ORM |
| Email | Resend |
| Calendar | Provider-neutral broker interface — Cronofy or direct Google |
| Tests | Vitest |

## Setup

### Environment

`docs/release-runbook.md` is the full reference. The minimum for local
development:

```bash
TURSO_DATABASE_URL=file:get2gethr-dev.db
AUTO_MIGRATE=1                       # development only
ENCRYPTION_KEY=any-long-random-string
EMAIL_FROM="get2gethr <dev@localhost>"
NEXT_PUBLIC_BASE_URL=http://localhost:3100

# At least one calendar provider, or calendar connection is disabled:
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Web

```bash
npm install
npm run db:migrate     # or set AUTO_MIGRATE=1
npm run dev
```

### iOS

Open `ios/get2gethr.xcodeproj`. The Debug configuration points at
`http://localhost:3100`; change `GET2GETHR_BASE_URL` in the build settings to
point somewhere else.

Universal links need the **Associated Domains** capability enabled for the App
ID in the Apple Developer portal.

## Checks

```bash
npm run check   # lint + typecheck + tests + production dependency audit
```

## Project structure

```
get2gethr/
├── app/                      # Next.js pages + API routes
│   ├── api/calendar/         # Provider-neutral connect + callback
│   ├── api/events/           # Create, organizer management
│   ├── api/invite/[token]/   # Invitation, decline, slot response
│   └── .well-known/          # apple-app-site-association
├── lib/
│   ├── calendar/             # Broker interface + Google/Cronofy/Fake adapters
│   ├── db/                   # Schema and versioned migrations
│   ├── time.ts               # Local-date and timezone primitives
│   ├── availability.ts       # Slot generation and ranking
│   ├── scheduler.ts          # Event and slot state machine
│   ├── authorization.ts      # Audience-scoped access and views
│   ├── oauth-state.ts        # Single-use authorization state
│   ├── rate-limit.ts         # Abuse limits
│   ├── ics.ts                # RFC 5545 calendar generation
│   └── email.ts              # Templates + delivery ledger
├── components/               # React UI
├── tests/                    # Vitest suites
├── docs/                     # Runbook and broker evaluation
└── ios/get2gethr/            # SwiftUI app
```

## Design notes

- **Dates are local calendar dates**, inclusive at both ends, resolved in the
  event's IANA timezone. Not instants. `lib/time.ts` explains why.
- **`confirmed` means the meeting exists on a calendar.** A time everyone agreed
  to but that could not be written is `action_required`, and everyone still gets
  the ICS fallback.
- **The organizer is a participant row**, not a special case beside one. That is
  what puts their availability in the search.
- **The invite token is not OAuth state.** State is a single-use nonce bound to
  one participant, and the connected account must match the invited address.

## License

Private.
