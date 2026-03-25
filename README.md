# get2gethr

Automated group scheduling. Create an event, invite participants, connect Google Calendars, and find a time that works for everyone — no back-and-forth.

## How It Works

1. **Create an event** — set a date range, duration, and working hours
2. **Invite participants** — they receive email invitations with unique links
3. **Connect calendars** — each participant grants read-only access to their Google Calendar free/busy data
4. **Auto-propose** — once everyone's connected, the app finds available slots and proposes the best one
5. **Confirm** — participants confirm or decline; if declined, the next slot is proposed automatically

## Stack

| Layer | Technology |
|-------|-----------|
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| iOS | SwiftUI, iOS 17+ |
| Database | Turso (libSQL) via Drizzle ORM |
| Email | Resend |
| Calendar | Google Calendar API (free/busy) |
| Auth | Google OAuth 2.0 (per-participant, scoped to calendar read) |

## Setup

### Environment Variables

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
ENCRYPTION_KEY=any-random-string
RESEND_API_KEY=your-resend-key
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### Web

```bash
npm install
npm run dev
```

### iOS

Open `ios/get2gethr.xcodeproj` in Xcode. The app targets iOS 17+ and connects to the same backend API.

Update the `baseURL` in `Services/APIClient.swift` to point to your deployed instance.

## Project Structure

```
get2gethr/
├── app/                    # Next.js pages + API routes
│   ├── api/               # REST API (events, invites, auth)
│   ├── events/[id]/       # Event dashboard page
│   └── invite/[token]/    # Invitation + confirmation pages
├── lib/                    # Server-side logic
│   ├── db/                # Drizzle schema + Turso connection
│   ├── scheduler.ts       # State machine (advance events, finalize slots)
│   ├── availability.ts    # Free slot computation
│   ├── google-calendar.ts # OAuth + Calendar API
│   ├── email.ts           # Resend templates
│   └── crypto.ts          # AES-256 token encryption
├── components/             # React UI components
└── ios/                    # SwiftUI iOS app
    └── get2gethr/
        ├── Views/         # CreateEvent, Dashboard, Invite, SlotConfirm
        ├── Models/        # Data models + theme
        ├── Services/      # API client
        └── Components/    # Reusable UI (chips, banners)
```

## License

Private.
