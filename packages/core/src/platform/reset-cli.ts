// docker-entrypoint.sh runs this before migrate when VENDUA_ALLOW_RESET=1: a reset staff asked
// for in the CRM happens here, with the owner credentials the server never gets.
import { resetIfRequested } from '../modules/instance-reset.ts';

if (process.env.VENDUA_ALLOW_RESET === '1') {
  await resetIfRequested(
    process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua',
  );
}
