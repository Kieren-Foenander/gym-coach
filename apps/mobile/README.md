# Gym for iPhone and Android

The native version of the training log, built with React Native and Expo. It signs in to the same server as the web app and has the same screens, plus what a web page cannot do:

- Sets are saved on the phone the moment you log them and sent when there is signal. Every screen you have opened stays readable offline. Starting or finishing a workout and editing the plan need a connection.
- When a rest ends you get a notification with a sound, even with the phone locked.
- On an iPhone, the rest countdown shows on the Lock Screen and in the Dynamic Island (a Live Activity). This needs the app's own build; it does not appear in Expo Go.
- The screen stays on during a workout, and logging a set gives a tap of haptic feedback.
- On an iPhone, it can connect to Apple Health (Settings, Apple Health). It reads bodyweight, body fat and waist, cardio workouts from an Apple Watch or other apps, heart rate and calories for workouts tracked on a watch, daily sleep, resting heart rate, HRV, steps and VO2 max, which show on Today and are there for the AI coach, and calories and macros from a food tracker that writes to Health, which count in the food log. It syncs when the app opens and only reads; it never writes to Health. This needs the app's own build.

Run every command below from `apps/mobile`.

```sh
bun install
```

## Try it on your phone today, with no developer account

[Expo Go](https://expo.dev/go) is a free app from the App Store and Google Play that runs this code inside itself.

```sh
bun run start
```

Scan the QR code it prints with the iPhone camera. The phone and this computer must be on the same Wi-Fi; if that does not connect, use `bun run start:tunnel`.

The app signs in to the live server by default. To point it somewhere else, type another address in the "Server address" field on the sign-in screen, or set `EXPO_PUBLIC_GYM_SERVER_URL` before starting.

Everything works in Expo Go except the Live Activity and Apple Health.

## Build the real app

A build of its own is what goes on the Home Screen with the app's icon and works without this computer. iPhone builds are made by Expo's build service (EAS), and need an [Apple Developer membership](https://developer.apple.com/programs/).

```sh
bunx eas-cli login
bunx eas-cli init                 # once: registers the project and writes its id into the config
bun run eas:ios:preview           # a standalone build, installed from a link
bun run eas:ios:dev               # a development build that loads code from this computer
bun run eas:ios:prod              # a build for TestFlight and the App Store
```

Android builds need no paid account: `bun run eas:android:dev` makes an APK you can install directly.

There are three variants, chosen with `APP_VARIANT`, each with its own name and identifier so they can sit side by side on one phone: `development` (Gym Dev), `preview` (Gym Preview) and `production` (Gym). The identifier is `com.kierenfoenander.gym`; set `GYM_APP_IDENTIFIER` to use another, before the first build.

## How it is put together

```
app.config.ts     the app's name, identifiers, permissions and plugins
global.css        colours and type, the same as the web app's, used through class names (Uniwind)
src/api/          the client for the server's JSON API, and who is signed in
src/data/         the cache of what the server said, and the queue of sets waiting to be sent
src/components/   buttons, cards, inputs, icons, the trend chart
src/features/     one folder per screen: today, plan, exercises, history, settings, workout, auth
src/navigation.tsx  every screen and what it needs to be opened
test/             tests for the logic that needs no phone
```

The app shares code with the web app instead of copying it. `~/` in an import is the repository's `src/`: the exercise library, plate maths, weekly summary and formatting come from `src/domain` and `src/format.ts`. Server code is only ever imported for its types, so the calls the app makes are checked against the server at compile time and nothing from the server ends up in the app. A test (`test/imports.test.ts`) keeps it that way.

The list of rendered exercise demonstrations is asked from the server, and the videos are played from it, so a newly rendered exercise shows up without a new build of the app.

## Checks

```sh
bun run check      # typecheck and tests
bun run export     # builds the JavaScript bundles for both platforms, as a build would
```

The repository's lint (`bun run lint` at the root) covers this folder too.
