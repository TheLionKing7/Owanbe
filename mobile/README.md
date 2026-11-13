# Ówàńbè on the phone (F-108)

The phone app has two halves:

- **My card** — a guest claims an invitation link with a name and a phone number, and carries the
  entry card that comes back. The card is a QR code the door reads with the camera. The guest needs
  no account.
- **The door** — the person at the door signs in with their own Ówàńbè account, pairs the device
  with the code the host gives them, and admits guests. When the phone cannot reach the platform it
  decides from its own cache, and the admission is sent when the phone is back online.

## QR first, NFC second

The **QR code is the way in**. The camera path works on every phone, on iOS and on mid-range
Android, with nothing but the app.

**NFC is an optional fast track**, not a requirement:

- Writing a card to a tag is **Android only**. An iPhone can show the code and the door reads it
  with the camera.
- Reading a tag at the door needs a **development build** — the NFC reader is a native module and
  Expo Go cannot load it.
- A phone without NFC, or an app built without it, is never blocked: the camera and the typed code
  are always there.

The rules the door uses — the cache, the card shape, the queue — are the ones the web app uses, in
[../src/features/tickets/scanner.ts](../src/features/tickets/scanner.ts). The pairing code is in
[../src/features/tickets/pairing.ts](../src/features/tickets/pairing.ts). Both are shared on
purpose, so the phone and the tests cannot drift apart.

## Running it

The NFC reader is a native module, so this app needs a development build. Expo Go cannot load it.

```sh
cd mobile
cp .env.example .env      # fill it in on this machine; never commit it
npm install
npx expo prebuild
npx expo run:android --device   # or: npx expo run:ios --device
```

iOS also needs the Near Field Communication Tag Reading capability on the app's App ID, and a
provisioning profile that allows NFC. The NFC tag reader itself is Android-only for writing; an
iPhone can read a tag at the door.

## Settings

Every setting is read from the environment and the app refuses to start without it. The publishable
Supabase key is public by design; no secret key is ever read by this app.

| Name                                   | What it is                                             |
| -------------------------------------- | ------------------------------------------------------ |
| `EXPO_PUBLIC_SUPABASE_URL`             | The Supabase project URL                               |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable (anon) key                             |
| `EXPO_PUBLIC_AUTH0_DOMAIN`             | The Auth0 tenant domain                                |
| `EXPO_PUBLIC_AUTH0_CLIENT_ID`          | The Auth0 application (client) id                      |
| `EXPO_PUBLIC_AUTH0_AUDIENCE`           | The API audience, for example `https://api.owanbe.app` |

## What is kept on the phone

The guest's session, the door's pairing, the cache of admission minimums and the queue of
check-ins taken while offline. All of it in the device's locked drawer (`expo-secure-store`), never
in plain storage. The cache holds a name, a state and an expiry for each card — the same minimum
the platform hands the scanner, and no phone number or address. It also holds the moment the
platform last gave it that list, because a door may only answer from a cache the platform gave it
and only while the door window is open. The rule is in
[../docs/decisions/f108-offline-cache-window.md](../docs/decisions/f108-offline-cache-window.md).
