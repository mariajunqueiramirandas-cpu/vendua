#!/usr/bin/env bash
# Generates the release keystore for Venduá Impressora and prints the GitHub secrets CI needs.
# Every future update must be signed with this same key: keep the file and password somewhere safe.
set -euo pipefail

out="${1:-vendua-impressora-release.jks}"
alias="${VENDUA_KEY_ALIAS:-vendua-impressora}"

if [ -e "$out" ]; then
  echo "error: $out already exists; refusing to overwrite it (a lost key means installed apps can't update)." >&2
  exit 1
fi
command -v keytool >/dev/null || { echo "error: keytool not found (install a JDK)." >&2; exit 1; }

pass="${VENDUA_KEYSTORE_PASSWORD:-$(head -c 48 /dev/urandom | base64 | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-32)}"

# PKCS12 uses one password for the store and the key.
keytool -genkeypair \
  -keystore "$out" -storetype PKCS12 \
  -alias "$alias" -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$pass" -keypass "$pass" \
  -dname "CN=Vendua Impressora, O=Vendua, L=Sao Paulo, C=BR" >/dev/null

cat <<MSG
Created $out (alias "$alias"). Back it up offline; never commit it.

Set these GitHub Actions secrets (Settings → Secrets and variables → Actions):

ANDROID_KEYSTORE_PASSWORD=$pass
ANDROID_KEY_ALIAS=$alias
ANDROID_KEY_PASSWORD=$pass
ANDROID_KEYSTORE_BASE64=
MSG
base64 <"$out" | tr -d '\n'
echo
cat <<MSG

Local signed build:
  VENDUA_KEYSTORE=\$PWD/$out VENDUA_KEYSTORE_PASSWORD=... VENDUA_KEY_ALIAS=$alias VENDUA_KEY_PASSWORD=... ./gradlew assembleRelease
MSG
