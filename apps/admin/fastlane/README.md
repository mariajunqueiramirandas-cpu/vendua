# The admin app's credentials and releases

`.github/workflows/admin-app.yml` builds the app on every PR that touches it. On `main` (or a
manual run on `main`), each output turns on once its credentials exist; without them the
workflow only builds and says what is missing (ADR 0044 §8; Phase 0 opens the accounts).

| Output                                                        | Needs                  |
| ------------------------------------------------------------- | ---------------------- |
| Signed Android APK on a GitHub Release `admin-app-v<version>` | Android signing        |
| Play internal testing (`fastlane android internal`)           | Android signing + Play |
| TestFlight (`fastlane ios beta`)                              | Apple                  |

A Release holds one APK per `app-version.json` `version` and is never marked latest (the admin
links the print agents' `releases/latest`). It is for the team: an APK from GitHub is signed with
the upload key, so it can't update an install from Play (Play re-signs with its own key), nor
the other way round.

## GitHub Actions secrets (Settings → Secrets and variables → Actions)

**Android signing** (the APK, and Play's upload):

| Secret                             | What, and where it comes from                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64`   | The upload key. Make it once and keep it offline: `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`, then `base64 -w0 upload.jks`. |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | The keystore's password.                                                                                                                                                               |
| `ANDROID_UPLOAD_KEY_ALIAS`         | `upload` (the `-alias` above).                                                                                                                                                         |
| `ANDROID_UPLOAD_KEY_PASSWORD`      | The key's password.                                                                                                                                                                    |
| `GOOGLE_SERVICES_JSON_BASE64`      | Firebase console → a project → add an Android app `br.com.vendua.painel` → download `google-services.json` → `base64 -w0`. Without it the app can't register for order alerts (FCM).   |

**Play** (on top of Android signing):

| Secret                      | What, and where it comes from                                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLAY_SERVICE_ACCOUNT_JSON` | A Google Cloud service account's JSON key, invited in Play Console → Users and permissions with release rights for the app. Play only accepts API uploads after the app exists and its first bundle went up by hand, with Play App Signing on. |

**Apple** (TestFlight):

| Secret                          | What, and where it comes from                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`   | App Store Connect → Users and Access → Integrations → App Store Connect API: a key with the App Manager role.                                        |
| `ASC_KEY_P8`                    | That key's `.p8` file, its text as is.                                                                                                               |
| `APPLE_TEAM_ID`                 | Apple Developer → Membership.                                                                                                                        |
| `MATCH_GIT_URL`                 | A private repo for the signing certificate and profile, filled once from a Mac with `fastlane match appstore --app_identifier br.com.vendua.painel`. |
| `MATCH_PASSWORD`                | The passphrase `match` encrypted that repo with.                                                                                                     |
| `MATCH_GIT_BASIC_AUTHORIZATION` | `base64 -w0` of `<github user>:<token that can read that repo>`.                                                                                     |

Before `match` runs: the App ID `br.com.vendua.painel` with Push Notifications, Associated Domains
and Time Sensitive Notifications on, and the app's record in App Store Connect.

**Variable** (Settings → Secrets and variables → Actions → Variables): `VITE_APP_STORE_URL`, the
App Store page (`https://apps.apple.com/br/app/vendua/id<number>`) once the listing exists. It
gives the "atualize o app" screen its button on iPhones; Play's link is fixed. Deploys bake it
into Core's image too.

## Core's environment (the server, `.env` / Dokploy)

| Variable                      | What, and where it comes from                                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APNS_KEY_P8`                 | Apple Developer → Keys → a key with Apple Push Notifications service; its `.p8` text (newlines as `\n`). Sends iPhone alerts.                                                                                                     |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | That key's id, and the team id.                                                                                                                                                                                                   |
| `APNS_TOPIC`                  | `br.com.vendua.painel` (the default).                                                                                                                                                                                             |
| `FCM_SERVICE_ACCOUNT_JSON`    | Firebase → Project settings → Service accounts → Generate new private key: the whole JSON. Sends Android alerts.                                                                                                                  |
| `VENDUA_IOS_APP_IDS`          | `<TEAMID>.br.com.vendua.painel`: admin links open the iPhone app (Universal Links).                                                                                                                                               |
| `VENDUA_ANDROID_CERT_SHA256`  | Play Console → Test and release → App integrity → App signing key's SHA-256, plus the upload key's (`keytool -list -v -keystore upload.jks`) comma-separated, so links open both the Play install and the GitHub APK (App Links). |
| `VENDUA_REVIEW_LOGIN`         | `<phone>:<6 digits>` for App Review's sign-in, a phone whose stores are all demo stores (`tenants.is_demo`). Rotate after each review.                                                                                            |
| `VENDUA_ADMIN_MIN_NATIVE`     | Optional: shells below this `native` level get the store-update screen.                                                                                                                                                           |

Every one of them is off when unset: the app still signs in and works, without that part.

## Versions

The build number is the workflow's run number, so it always goes up. The store version is
`app-version.json` `version`; raise it, and `native` when the shell changed
(`tools/check-admin-native.mjs` fails the PR otherwise), then run
`bun scripts/native-version.ts`. A new `version` is also what makes a new GitHub Release.

Locally: `gem install fastlane`, then `fastlane ios beta` / `fastlane android internal` from
`apps/admin` with the same variables set.
