#!/usr/bin/env bash
# Builds the app for the iOS Simulator, with its JavaScript bundled in, at ios/build/.../<Scheme>.app.
# .github/workflows/ios-tour.yml runs it from apps/mobile on a macOS runner, and keys its cache of the build on
# this file, so a change here builds the app again.
#
# APP_VARIANT picks the app (see app.config.ts) and EXPO_PUBLIC_GYM_SERVER_URL the server it signs in to.
set -euo pipefail

: "${APP_VARIANT:?Set APP_VARIANT}"

export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

npx expo prebuild --platform ios --clean

SCHEME=$(basename ios/*.xcworkspace .xcworkspace)

# The keychain (expo-secure-store, which keeps the session) needs the app's entitlements, and only a signed
# build carries them. "-" signs it ad hoc, which the simulator accepts without an Apple account.
xcodebuild \
  -workspace "ios/$SCHEME.xcworkspace" -scheme "$SCHEME" \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
  build | xcbeautify

APP="ios/build/Build/Products/Release-iphonesimulator/$SCHEME.app"
test -d "$APP"
codesign --display --entitlements - --xml "$APP" | plutil -p - || echo "No entitlements in the signature"
