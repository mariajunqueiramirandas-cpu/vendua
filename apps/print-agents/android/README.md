# Venduá Impressora (Android)

The Android print agent: a thin pipe that pairs a tablet or phone with a store, keeps an SSE
stream open to Core, and writes the ESC/POS bytes of each print job to a Bluetooth, USB or
network printer. The contract with Core is the shared print-agent spec. The version comes from
`../VERSION`, shared with the Windows agent. `versionCode` is `major*10000 + minor*100 + patch`.

## Build

Requirements: JDK 17+ and the Android SDK (`platforms;android-36`, `build-tools;36.0.0`), with
`ANDROID_HOME` set or `sdk.dir` in `local.properties`.

```sh
./gradlew assembleDebug                  # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease                # R8-minified; signed only when the env vars below are set
./gradlew testDebugUnitTest lintDebug    # JVM unit tests (MockWebServer) + lint
```

The toolchain is pinned on purpose: AGP 8.13 / compileSdk 36 / Kotlin 2.2.21. Newer
AndroidX releases (core 1.19, Compose 1.12, lifecycle 2.11) need compileSdk 37 and AGP 9.1, so
`libs.versions.toml` stays below them. Lint's "newer version" checks are turned off for that
reason.

`API_BASE` (BuildConfig) defaults to `https://painel.vendua.com.br`. Staff can change it on a
device by long-pressing the title bar.

## Release signing

`assembleRelease` signs the APK when all of these are set:

| env var                    | GitHub secret                                      |
| -------------------------- | -------------------------------------------------- |
| `VENDUA_KEYSTORE` (path)   | `ANDROID_KEYSTORE_BASE64`, decoded to a file by CI |
| `VENDUA_KEYSTORE_PASSWORD` | `ANDROID_KEYSTORE_PASSWORD`                        |
| `VENDUA_KEY_ALIAS`         | `ANDROID_KEY_ALIAS`                                |
| `VENDUA_KEY_PASSWORD`      | `ANDROID_KEY_PASSWORD`                             |

Without them the release APK is left unsigned. To create the key once, run:

```sh
scripts/make-keystore.sh [out.jks]
```

The script prints the four secret values to set. Keep the `.jks` file and its password backed up
offline. Every update must be signed with the same key, or installed apps can't update.
CI publishes the APK as `vendua-impressora.apk` on GitHub Releases, next to the Windows exe and
`version.json`. No release goes out until the four `ANDROID_KEYSTORE_*` secrets exist: once they
do, run the `print-agents` workflow on `main` to publish the current `VERSION`.

## Installing (merchants)

The app is distributed as an APK from the Venduá site and GitHub Releases, not from Play:

1. On the tablet, open the download link and tap the downloaded `vendua-impressora.apk`.
2. Android asks to allow installs from that source (the browser or Files app). Choose
   **Configurações → Permitir desta fonte**, go back, and tap **Instalar**.
3. Open **Venduá Impressora**, tap **Conectar à loja**, and approve the code in the admin
   (**Impressoras**, `https://painel.vendua.com.br/admin/impressoras`), or scan the QR code with
   the phone that is signed in to the admin.

Updates: the app checks `version.json` at startup and every 6 h. When a newer version exists it
shows **Nova versão x.y.z → Atualizar**, which downloads the APK and installs it with
`PackageInstaller`. The first time, Android asks to allow installs from Venduá Impressora. If
anything fails, the APK link opens in the browser.

**Android developer verification.** Google's developer-verification rule reaches direct APK
installs (sideloading) on certified Android devices in 2027: apps from unverified developers
won't install there. Registering the developer, package name and signing key is deferred by the
product owner. Revisit it before enforcement, or installs from the site will be blocked.

## What the app needs from the merchant

- **Notifications** (Android 13+): shows the "Impressão automática ativa" notification and the
  "Toque para reativar" alert.
- **Nearby devices / Bluetooth** (Android 12+): needed to print to Bluetooth printers. The
  printer must first be paired in the system Bluetooth settings (PIN is usually 0000 or 1234),
  then picked in **Adicionar impressora**.
- **USB**: Android asks for permission per printer. The app is offered automatically when a
  USB printer (class 7) is plugged in. Some tablets need an OTG adapter.
- **Battery: unrestricted / "Não otimizar"**: the most important setting. Without it, Android
  may stop the service while the screen is off, and it can't be restarted from the background
  (Android 12+). The checklist button opens the system list. The app does not declare
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
- Keep the device powered, on Wi-Fi, and near the printers.

The service starts on boot and after updates when paired. A WorkManager watchdog checks every
15 min and restarts the service, or posts "Toque para reativar a impressão automática" when
Android refuses a background start.

## Layout

```
app/src/main/java/br/com/vendua/impressora/
  api/      ApiClient, models, SSE EventStream, pairing poller, backoff   (pure JVM)
  print/    JobRunner, FinishedStore, ResultPoster, TCP/USB/Bluetooth transports
  service/  PrintService (foreground, connectedDevice), Agent, boot/watchdog/USB receivers
  ui/       Compose screens: welcome, pairing (code + QR), home, setup checklist
  update/   version.json check, semver, PackageInstaller self-update
```
