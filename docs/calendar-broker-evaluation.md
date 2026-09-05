# Calendar integration decision — direct OAuth first

**Status:** direct Google and Microsoft selected; broker remains optional.
**Updated:** 2026-09-01

## The decision in one paragraph

There is no universal calendar OAuth standard. To keep recurring vendor costs
low, get2gethr now owns the two integrations that cover the largest audience:
direct Google Calendar and direct Microsoft Graph for Microsoft 365 and
Outlook.com. Cronofy remains an optional adapter for Apple iCloud and Exchange
coverage. Nylas is not needed for the current scope. Apple still requires a
broker or a future manual-availability path; an ICS attachment alone cannot
provide live free/busy data.

## What has already been built

The code no longer assumes Google. `lib/calendar/types.ts` defines a
`CalendarBroker` interface — authorize, list calendars, read free/busy, create
an event idempotently, revoke — and everything above it (the scheduler, the API
routes, both clients) is written against that interface alone.

Four adapters implement it:

| Adapter | File | State |
|---|---|---|
| Google (direct) | `lib/calendar/google.ts` | Works today with the existing credentials. Google accounts only. |
| Microsoft (direct) | `lib/calendar/microsoft.ts` | Implemented against Microsoft identity and Graph v1.0. Needs an Entra app and live-account verification. |
| Cronofy (broker) | `lib/calendar/cronofy.ts` | Written against the published API. **Never run against a live account.** |
| Fake (tests) | `lib/calendar/fake.ts` | Drives the test suite, including outage and revocation paths. |

Selection is provider-aware. A Google choice uses direct Google when configured;
a Microsoft choice uses direct Microsoft; either can fall back to Cronofy when
the direct credentials are absent. `CALENDAR_BROKER` can still force one adapter
deployment-wide. OAuth state records the selected adapter so a callback always
finishes through the route that started it.

Provider access and refresh tokens are encrypted at rest. Rotated Microsoft and
Cronofy refresh tokens are persisted before calendar API calls, so long-lived
connections do not silently degrade after the first access token expires.

## When Cronofy is still useful

- **One API covers Google, Microsoft/Office 365, Exchange, and iCloud**, including
  availability, event creation, and calendar-change webhooks.
  ([quick start](https://docs.cronofy.com/developers/getting-started/quick-start-guide/api-quick-start-guide/))
- **`free_busy_write` is the right access model for this product.** It reads
  availability and writes only the events we manage — the least privilege that
  still lets us create the meeting. Implemented: attendees are asked for
  `free_busy`, only the organizer is asked for `free_busy_write`.
- **Event creation is an upsert on `(calendar_id, event_id)`**, so replaying a
  confirmation updates the one meeting instead of creating a second.
  ([upsert event](https://docs.cronofy.com/developers/api/events/upsert-event/))
  This is what makes the "exactly one event after repeated callbacks" gate
  achievable.
- **An embeddable Calendar Sync UI element** handles provider choice, connecting,
  relinking, and disconnecting, which is a meaningful chunk of UI we would
  otherwise build and maintain.
- **Data-centre selection** (`CRONOFY_DATA_CENTER`) is already wired, because
  residency is one of the review criteria below.

## Why Nylas is the fallback, not the pick

Nylas v3 hosted auth also manages provider tokens, and its group-availability API
spans the same providers. It becomes the better choice **if get2gethr expects to
add email or contacts as core surfaces** — that is Nylas's breadth and Cronofy's
deliberate gap. For a scheduling-only product it is a wider surface than needed.

Nylas is also the more honest source on the Apple constraint: iCloud Calendar has
no public REST/OAuth API and works over CalDAV with an **app-specific password**.
That is a user-visible wart under either vendor. The invite UI already discloses
it, and the copy is in place.

## Open questions before adding a broker

None of these can be settled from the code, and two of them are signatures.

1. **Pricing.** Both are per-connected-account. Get a current quote at the
   expected number of connected calendars, not list price.
2. **Data residency.** Which data centre, and does it have to be EU?
3. **DPA and subprocessors.** Review before any production authorization.
4. **Deletion guarantees.** What happens to stored grants and cached availability
   when we delete an account, and how long does it take?
5. **Rate limits and webhook guarantees.** Delivery semantics, retries, ordering.
6. **iCloud UX.** Confirm the app-specific-password flow end to end; it is the
   most likely place for a person to give up.
7. **Sandbox access.** Needed for the two-provider spike below.
8. **Vendor exit.** Export format for grants and mappings, so a later migration is
   not a re-authorization campaign across every user.

## Recommended next step

1. Register the canonical callback in Google Cloud and Microsoft Entra.
2. Connect one Google account, one Microsoft 365 account, and one Outlook.com
   personal account.
3. Verify account matching, multi-calendar busy aggregation, refresh-token
   rotation, and exactly-one event creation after a retried confirmation.
4. Decide whether Apple/Exchange demand justifies a Cronofy contract. If not,
   leave those provider choices hidden rather than presenting a dead end.

## Configuration reference

```bash
# Optional broker for Apple/Exchange or a single-provider deployment
CRONOFY_CLIENT_ID=...
CRONOFY_CLIENT_SECRET=...
CRONOFY_DATA_CENTER=us          # us | de | au | uk | ca | sg

# Direct Google
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Direct Microsoft 365 and Outlook.com
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...

# Optional: force one adapter deployment-wide
CALENDAR_BROKER=microsoft       # microsoft | google | cronofy

# Whether a connected account must match the invited address.
# `strict` is the default and the safe posture.
CALENDAR_IDENTITY_POLICY=strict # strict | relaxed
```

## What does not change with a broker

A broker does not remove the user's consent step, and Apple still uses an
app-specific password behind the broker's UI. It removes our per-provider
maintenance and our custody of provider refresh tokens, but that tradeoff only
makes financial sense if Apple/Exchange support is important enough.
