// Creates the next Core migration:  bun run migration:new <name>   (from packages/core)
//   → packages/core/db/migrations/NNNN_<name>.sql, NNNN being the highest number there + 1.
// The number is read at run time, so two people (or agents) who each create one get distinct
// files; if both land with the same number, the later merge is the one that renumbers.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'packages/core/db/migrations');
const NAME = /^[a-z][a-z0-9_]{1,59}$/;

/** The highest NNNN among `NNNN_*.sql` files, -1 for none. */
export function lastNumber(files) {
  let n = -1;
  for (const f of files) {
    const m = /^(\d{4})_.+\.sql$/.exec(f);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n;
}

export function skeleton(file) {
  return `-- ${file} — what this adds, and why.
--   <table or column> — what a row (or the column) is for
-- Additive only: new tables, and columns that are nullable or defaulted. Re-runnable
-- ("if not exists", "drop policy if exists"): the ledger runs a file once, but a failed
-- deploy replays it.

-- A column on an existing table:
-- alter table store_settings add column if not exists example_until timestamptz;

-- A table of one store: tenant_id, and a row-level-security policy that scopes every query to
-- the tenant set by \`SET LOCAL vendua.tenant_id\` (platform/db.ts). Uncomment and rename.
-- create table if not exists example (
--   id uuid primary key default gen_random_uuid(),
--   tenant_id uuid not null references tenants (id) on delete cascade,
--   created_at timestamptz not null default now()
-- );
-- create index if not exists example_by_store on example (tenant_id, created_at);
--
-- alter table example enable row level security;
-- drop policy if exists tenant_isolation on example;
-- create policy tenant_isolation on example
--   using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
--   with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
-- -- staff (the CRM) read across stores under \`vendua.control\`; leave this out if they never do
-- drop policy if exists control_access on example;
-- create policy control_access on example for all
--   using (current_setting('vendua.control', true) = '1')
--   with check (current_setting('vendua.control', true) = '1');
-- grant select, insert, update, delete on example to vendua_app;
`;
}

export function create(name, dir = DIR) {
  if (!NAME.test(name ?? ''))
    throw new Error(
      `'${name ?? ''}' is not a migration name: lowercase letters, digits and underscores, starting with a letter (e.g. add_coupon_limits)`,
    );
  const next = lastNumber(readdirSync(dir)) + 1;
  const file = `${String(next).padStart(4, '0')}_${name}.sql`;
  const path = join(dir, file);
  if (existsSync(path)) throw new Error(`${file} already exists`);
  // flag wx: never overwrite a file another process created between the listing and now
  writeFileSync(path, skeleton(file), { flag: 'wx' });
  return path;
}

if (import.meta.main) {
  try {
    const path = create(process.argv[2]);
    console.log(path.replace(`${ROOT}/`, ''));
  } catch (e) {
    console.error(`migration:new: ${e.message}`);
    process.exit(2);
  }
}
