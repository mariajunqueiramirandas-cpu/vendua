# The admin app's store builds

`.github/workflows/admin-app.yml` runs these lanes on `main` when the app changed, once the
secrets exist (ADR 0044 §8, Phase 0 opens the accounts). Without them the workflow only builds.

| Lane | Goes to | Secrets (GitHub Actions) |
| --- | --- | --- |
| `ios beta` | TestFlight | `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (App Store Connect API key), `APPLE_TEAM_ID`, `MATCH_GIT_URL`, `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION` (the signing certificates repo `fastlane match` reads) |
| `android internal` | Play internal testing | `PLAY_SERVICE_ACCOUNT_JSON`, `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD`, `GOOGLE_SERVICES_JSON_BASE64` (the Firebase project's `google-services.json`, for FCM) |

The build number is the workflow's run number, so it always goes up. The store version is
`app-version.json` `version`; raise it, and `native` when the shell changed
(`tools/check-admin-native.mjs` fails the PR otherwise), then run
`bun scripts/native-version.ts`.

Core needs its side too: `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`
(`br.com.vendua.painel`), `FCM_SERVICE_ACCOUNT_JSON`, `VENDUA_IOS_APP_IDS`
(`<TEAMID>.br.com.vendua.painel`) and `VENDUA_ANDROID_CERT_SHA256` (Play's app signing key).

Locally: `bundle exec`-free, `gem install fastlane` then `fastlane ios beta` / `fastlane android
internal` from `apps/admin` with the same variables set.
