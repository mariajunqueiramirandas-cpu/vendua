#!/bin/sh
# @vendua/core container entrypoint — migrate, optionally seed demo tenants,
# then serve. Migrations are idempotent; the server's boot migrate() becomes
# a no-op after this.
set -e

bun run migrate
if [ "$SEED_DEMO" = "1" ]; then
  bun run seed
fi
exec "$@"
