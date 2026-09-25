#!/bin/bash
# Cloud sessions: pinned bun, workspace deps, and a migrated+seeded local Postgres
# (port 5433, same URLs as packages/core defaults) so Core, its tests and the
# control apps run without extra setup.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
BUN_VERSION="$(jq -r '.packageManager' package.json | sed 's/^bun@//')"

# packageManager pins bun; a different local version rewrites bun.lock
if [ "$(bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
  npm install -g "bun@$BUN_VERSION" --silent
  NPM_BIN="$(npm prefix -g)/bin"
  export PATH="$NPM_BIN:$PATH"
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PATH=\"$NPM_BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

bun install

PG_BIN=/usr/lib/postgresql/16/bin
PG_DIR=/var/tmp/vendua-pg
if [ -x "$PG_BIN/pg_ctl" ] && id postgres >/dev/null 2>&1; then
  fresh=false
  if [ ! -f "$PG_DIR/data/PG_VERSION" ]; then
    mkdir -p "$PG_DIR" && chown postgres "$PG_DIR"
    su postgres -c "$PG_BIN/initdb -D $PG_DIR/data -U vendua --auth=trust" >/dev/null
    fresh=true
  fi
  if ! su postgres -c "$PG_BIN/pg_ctl -D $PG_DIR/data status" >/dev/null 2>&1; then
    su postgres -c "$PG_BIN/pg_ctl -D $PG_DIR/data -o '-p 5433 -k /tmp' -l $PG_DIR/log -w start" >/dev/null
  fi
  if $fresh; then
    psql -h localhost -p 5433 -U vendua -d postgres -qc 'create database vendua'
  fi
  (cd packages/core && bun run migrate >/dev/null)
  if $fresh; then
    (cd packages/core && bun run seed >/dev/null)
  fi
  [ -n "${CLAUDE_ENV_FILE:-}" ] &&
    echo 'export TEST_DATABASE_URL=postgres://vendua:vendua@localhost:5433/vendua' >> "$CLAUDE_ENV_FILE"
fi
