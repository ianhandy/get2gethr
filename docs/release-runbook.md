# Release runbook

What has to be true before get2gethr goes public, and how to check it.

## Quality gate

One command runs everything a merge should require:

```bash
npm run check     # lint + typecheck + tests + production dependency audit
```

| Gate | Command | Current |
|---|---|---|
| Lint | `npm run lint` | clean |
| Types | `npm run typecheck` | clean |
| Tests | `npm test` | 266 passing |
| Dependencies | `npm run audit:prod` | 0 advisories (dev + prod) |
| Web build | `npm run build` | passes |
| iOS build | `xcodebuild -project ios/get2gethr.xcodeproj -scheme get2gethr` | passes, no warnings |
| Signed archive | see below | **not run — needs signing** |

## Environment variables

### Required in production

| Variable | Why |
|---|---|
| `TURSO_DATABASE_URL` | Database. |
| `TURSO_AUTH_TOKEN` | Database. |
| `ENCRYPTION_KEY` | Encrypts calendar credentials at rest (AES-256-GCM). |
| `RESEND_API_KEY` | Email delivery. |
| `EMAIL_FROM` | **No default any more.** A verified sending domain; the app throws rather than silently sending from `example.com`. |
| `NEXT_PUBLIC_BASE_URL` | Absolute base for invite links and OAuth redirects. |

### Calendar provider — at least one set

See `docs/calendar-broker-evaluation.md`. With none configured the app refuses to
start a calendar connection rather than producing a broken authorization URL.

### Optional

| Variable | Default | Why |
|---|---|---|
| `ENCRYPTION_KEY_PREVIOUS` | — | Set during a key rotation so old ciphertexts still decrypt. |
| `CALENDAR_IDENTITY_POLICY` | `strict` | `relaxed` permits a connected account that is not the invited address. Not recommended. |
| `AUTO_MIGRATE` | off | Runs migrations on first request. **Development only.** |
| `APPLE_TEAM_ID` / `APPLE_BUNDLE_ID` | current values | Feed the app-site-association file. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `support@get2gethr.app` | Shown on the policy pages. |

Separate preview from production credentials, and rotate anything whose history
is uncertain.

## Migrations

Migrations are a deploy step, not a side effect of importing a module, and a
failure is fatal rather than logged and ignored.

```bash
npm run db:migrate
```

Run it **before** promoting a deployment. `AUTO_MIGRATE=1` exists for local
development only.

## Universal links

1. Deploy, then confirm the association file is served correctly:
   ```bash
   curl -sI https://get2gethr.app/.well-known/apple-app-site-association
   # must be 200, Content-Type: application/json, and NOT a redirect
   ```
2. Enable the **Associated Domains** capability for the App ID in the Apple
   Developer portal, and regenerate the provisioning profile. *(Needs Ian —
   this cannot be done from the repository.)*
3. Install a signed build and test a link from Mail, Messages, Safari, and a
   copied link, with the app installed and with it deleted.

`/api/*` is excluded from the association on purpose: capturing the OAuth
callback in the app would break calendar connection.

## Email deliverability

- Verify the sending domain in Resend and publish **SPF, DKIM, and DMARC**.
- Send a test to a Gmail and an Outlook address; check both land in the inbox.
- Confirm the `email_deliveries` table records sends — failures are recorded and
  resendable rather than discarded.

## Before submitting to the App Store

Done in this pass:

- App icon flattened; it no longer carries an alpha channel.
- `xcuserdata` removed from source control and ignored.
- Privacy, terms, and support pages published, describing what the code
  actually does.
- iPad support removed for v1 rather than shipping an unverified stretched
  phone layout. Reversible — see the note in the session log.

Still needed, and needing Ian:

- Signed archive and App Store validation.
- App Privacy disclosures in App Store Connect, plus the policy URL.
- Screenshots, captured **after** the visual fixes in this pass.
- Privacy manifest, if the final SDK/API inventory requires one.
- Export-compliance answers, age rating, category, review notes.
- TestFlight internal testing, then a production smoke test.

## Still open

- **Monitoring.** Structured error reporting, job and webhook metrics, calendar
  provider health, email delivery alerting, release markers.
- **Backups.** Turso backup schedule, retention, and a *tested* restore drill.
- **Broker contract.** See the evaluation document.
- **End-to-end with real accounts.** Needs the broker spike; the Cronofy adapter
  is written but has never run against a live account.
