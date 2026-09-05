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
| Tests | `npm test` | 280 tests pass |
| Dependencies | `npm run audit:prod` | 0 high/critical production advisories |
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
| `AWS_SES_REGION` | Region containing the verified SES identity. |
| `AWS_ROLE_ARN` | Least-privilege SES sender role assumed with Vercel OIDC. No long-lived production AWS key. |
| `EMAIL_FROM` | **No default any more.** A verified sending domain; the app throws rather than silently sending from `example.com`. |
| `NEXT_PUBLIC_BASE_URL` | Absolute base for invite links and OAuth redirects. |

### Calendar provider — at least one set

See `docs/calendar-broker-evaluation.md`. With none configured the app refuses to
start a calendar connection rather than producing a broken authorization URL.

- Direct Google: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- Direct Microsoft: `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`
- Optional broker: `CRONOFY_CLIENT_ID` and `CRONOFY_CLIENT_SECRET`

### Optional

| Variable | Default | Why |
|---|---|---|
| `ENCRYPTION_KEY_PREVIOUS` | — | Set during a key rotation so old ciphertexts still decrypt. |
| `CALENDAR_IDENTITY_POLICY` | `strict` | `relaxed` permits a connected account that is not the invited address. Not recommended. |
| `AUTO_MIGRATE` | off | Runs migrations on first request. **Development only.** |
| `APPLE_TEAM_ID` / `APPLE_BUNDLE_ID` | current values | Feed the app-site-association file. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `support@finda.day` | Shown on the policy pages. Explicit support requests may be forwarded to `help@ianhandy.com`; ordinary product mail must not reach a personal inbox. |
| `AWS_SES_CONFIGURATION_SET` | — | SES configuration set that publishes delivery, bounce, and complaint events. |
| `AWS_SNS_TOPIC_ARN` | — | Restricts the SES webhook to one expected SNS topic. |

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
   curl -sI https://finda.day/.well-known/apple-app-site-association
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

- Verify the sending domain in Amazon SES and publish **DKIM and DMARC**. Use a
  custom MAIL FROM domain when SPF alignment is required.
- Move SES out of the sandbox, create a configuration set, and publish delivery,
  bounce, and complaint events to the SNS topic consumed by `/api/webhooks/ses`.
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

## Operations prepared locally

- `GET /api/health` provides a database-backed readiness probe without exposing
  configuration details.
- `npm run db:backup -- <database> <secure-directory>` creates a compressed
  Turso logical dump and proves it can be restored before keeping it.
- The monitoring, PITR, retention, and restore-drill runbook is in
  `docs/operations.md`.

## Local visual and flow QA (2026-09-01)

- iOS: clean on iPhone SE (3rd generation) and iPhone 17 Pro; also checked
  Dark Mode and the largest accessibility text size on iPhone 17 Pro. No
  clipping or blocked controls were found.
- Web: create-event form and organizer dashboard inspected at desktop size;
  hierarchy, focusable controls, field errors, and legal/support navigation are
  intact.
- Flow: a local event request returned 201, persisted the organizer and attendee,
  and rendered the organizer dashboard. Malformed dates return 400 field errors,
  not a server error. The database-backed health probe returned 200.
- Still requires device/manual passes: VoiceOver traversal, Increase Contrast,
  Reduce Motion across every flow, and signed-build universal links.

## Still open

- **Monitoring activation.** Add the cloud health probe, Sentry project/release
  markers, calendar-provider alerts, and SES delivery alerts.
- **Backup activation.** Choose the encrypted bucket, schedule the Turso dump,
  apply retention, and perform the first restore drill.
- **End-to-end with real accounts.** Google and Microsoft direct adapters need
  live OAuth app credentials and organizer/attendee tests. Cronofy remains an
  optional Apple/Exchange path and has not been tested live.
