# Calendar broker evaluation — Cronofy vs Nylas

**Status:** recommendation ready, **decision and commercial terms need Ian.**
**Date:** 2026-08-31

## The decision in one paragraph

There is no universal calendar OAuth standard. Today get2gethr talks to Google
directly, which means a Microsoft, Apple, or Exchange user **cannot join a
meeting at all** — they get an invitation they can never act on. A broker
collapses four integrations into one and takes provider refresh tokens off our
infrastructure. **Cronofy is the recommendation**, with Nylas as the credible
fallback. Both are paid; neither has been exercised against a live account,
because that needs a developer account and a signature.

## What has already been built

The code no longer assumes Google. `lib/calendar/types.ts` defines a
`CalendarBroker` interface — authorize, list calendars, read free/busy, create
an event idempotently, revoke — and everything above it (the scheduler, the API
routes, both clients) is written against that interface alone.

Three adapters implement it:

| Adapter | File | State |
|---|---|---|
| Google (direct) | `lib/calendar/google.ts` | Works today with the existing credentials. Google accounts only. |
| Cronofy (broker) | `lib/calendar/cronofy.ts` | Written against the published API. **Never run against a live account.** |
| Fake (tests) | `lib/calendar/fake.ts` | Drives the test suite, including outage and revocation paths. |

Selection is `CALENDAR_BROKER`, or automatic: Cronofy when its credentials are
present, otherwise direct Google. With neither configured the app now refuses to
start a connection rather than sending someone to a provider page built from an
empty `client_id`.

**Switching brokers is an env var and one new file in `lib/calendar/`.** That is
the point of having done this first: the vendor choice is no longer load-bearing
for the rest of the release.

## Why Cronofy first

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

## Open questions — these need Ian

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

A **two-provider technical spike**, which is the one thing I could not do:

1. Ian obtains Cronofy and Nylas developer/sandbox accounts.
2. Connect a Google, a Microsoft, and an iCloud test account through each.
3. Run the existing suite against the real adapter — the `FakeCalendarBroker`
   tests already encode the behaviour to check for: idempotent writes, revoked
   grants, provider outages, availability changing mid-flight.
4. Compare on the eight criteria above.
5. Only then migrate production data.

The Cronofy adapter is written and typechecked but **unproven**; treat the spike
as validation of my implementation as much as of the vendor.

## Configuration reference

```bash
# Cronofy (preferred once contracted)
CRONOFY_CLIENT_ID=...
CRONOFY_CLIENT_SECRET=...
CRONOFY_DATA_CENTER=us          # us | de | au | uk | ca | sg

# Direct Google (works today, Google accounts only)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Force a specific broker; otherwise Cronofy wins when configured
CALENDAR_BROKER=cronofy         # cronofy | google

# Whether a connected account must match the invited address.
# `strict` is the default and the safe posture.
CALENDAR_IDENTITY_POLICY=strict # strict | relaxed
```

## What does not change with a broker

A broker does not remove the user's own consent step, and it does not make Apple
easier. It removes *our* per-provider integration work and *our* custody of
provider refresh tokens. Both are worth paying for; neither is magic.
