# Mobile wrapper

The shipping mobile app is a Capacitor shell around `https://finda.day`. The
website remains the single interface and deployment, while native plugins add
capabilities a browser cannot provide.

## Native capabilities

- **Device calendars:** iOS EventKit and Android Calendar Provider return only
  merged busy start/end timestamps inside an invitation's date window. Event
  titles, guests, notes, locations, and raw calendar records never reach the
  website or API.
- **Schedule images:** the iOS camera/photo picker, Vision OCR, and Apple
  Intelligence run on device. The person reviews editable busy blocks before
  only those confirmed dates and times are submitted.
- **Universal links:** `finda.day/invite/*` and `finda.day/events/*` are
  associated with the iOS app. API and OAuth callback paths remain web-only.

The earlier SwiftUI implementation is preserved in `ios-native/` while the
Capacitor iOS project lives in `ios/`.

## Commands

```sh
npm install
npm run cap:sync
npm run cap:ios
npm run cap:android
```

`CAPACITOR_SERVER_URL` may override the hosted URL for a local test build. Do
not ship a cleartext URL.

The iOS target keeps bundle ID `com.ianhandy.get2gethr`, Apple team
`X5BKD97T2F`, and the existing find·a·day icon. Android generation works on any
machine, but compiling it requires Android Studio or an equivalent JDK and
Android SDK.
