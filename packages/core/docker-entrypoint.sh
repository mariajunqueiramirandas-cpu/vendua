#!/bin/sh
# migrate (idempotent), optionally seed the blank dev store, then serve
set -e

# a reset staff asked for in the CRM (VENDUA_ALLOW_RESET=1 only): drop and recreate the database
if [ "$VENDUA_ALLOW_RESET" = "1" ]; then
  bun run reset:pending
fi
bun run migrate
if [ "$SEED_DEMO" = "1" ]; then
  bun run seed
fi
# the server never needs these: the owner URL and the app role's password only feed migrate/seed
unset MIGRATION_DATABASE_URL VENDUA_APP_DB_PASSWORD POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
exec "$@"
