#!/bin/sh
# migrate (idempotent), optionally seed demo tenants, then serve
set -e

bun run migrate
if [ "$SEED_DEMO" = "1" ]; then
  bun run seed
fi
exec "$@"
