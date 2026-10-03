-- 0082_plan_tiers.sql — the launch catalog (ADR 0032): three plans, the middle one recommended and
-- the only one with a trial; what each plan includes; the Vendedor's conversations and the packs
-- that add to them.
--   plans.recommended            — the plan signup and the site lead with (at most one)
--   plans.ai_conversations       — Vendedor conversations a paid month includes (0 = no Vendedor)
--   plans.ai_trial_conversations — the same for the whole free trial (Pangolin has no trial of its
--     own, but a Bandeira trial can switch to it and keeps trialing)
--   plans.features               — { customDomain, customSite, kds, printing, loyalty, vendedor }
--   ai_packs                     — platform catalog: extra conversations sold one-off by Pix
--   invoices.kind 'ai_pack'      — one pack bought; ai_pack_id says which, ai_conversations how many
--   ai_credits                   — conversations a paid pack added to a store (one per invoice)
--   ai_conversations             — one row per conversation the Vendedor took, and what paid for it

alter table plans
  add column if not exists recommended boolean not null default false,
  add column if not exists ai_conversations int not null default 0
    check (ai_conversations between 0 and 100000),
  add column if not exists ai_trial_conversations int not null default 0
    check (ai_trial_conversations between 0 and 100000);
create unique index if not exists plans_one_recommended on plans ((true)) where recommended;

-- the owner's decision (2026-10-03)
insert into plans (id, name, price_cents, fee_bps, features, public, sort, trial_days,
                   recommended, ai_conversations, ai_trial_conversations) values
  ('mirim', 'Venduá Mirim', 6990, 0,
   '{"customDomain": false, "customSite": false, "kds": false, "printing": false, "loyalty": false, "vendedor": false}',
   true, 1, 0, false, 0, 0),
  ('bandeira', 'Venduá Bandeira', 16900, 0,
   '{"customDomain": false, "customSite": false, "kds": true, "printing": true, "loyalty": true, "vendedor": true}',
   true, 2, 14, true, 250, 50),
  ('pangolin', 'Venduá Pangolin', 44900, 0,
   '{"customDomain": true, "customSite": true, "kds": true, "printing": true, "loyalty": true, "vendedor": true}',
   true, 3, 0, false, 1000, 50)
on conflict (id) do nothing;

-- Before the launch nobody paid for Basic or PRO+: stores on them (dev, staff tests) move to the
-- plan that replaces each, and the old rows stay only for the invoices that name them.
update tenants set plan = 'mirim' where plan = 'basic';
update tenants set plan = 'pangolin' where plan = 'pro_plus';
update subscriptions set plan_id = case plan_id when 'basic' then 'mirim' else 'pangolin' end
  where plan_id in ('basic', 'pro_plus');
update subscriptions set pending_plan_id = case pending_plan_id when 'basic' then 'mirim' else 'pangolin' end
  where pending_plan_id in ('basic', 'pro_plus');
update subscriptions set upgrade_plan_id = case upgrade_plan_id when 'basic' then 'mirim' else 'pangolin' end
  where upgrade_plan_id in ('basic', 'pro_plus');
-- an invoice still open on an old plan is the new plan's, at its price; its Pix (at the old price)
-- stays matchable, and a payment of it lands short and is flagged
update invoices set
  plan_id = case plan_id when 'basic' then 'mirim' else 'pangolin' end,
  amount_cents = case plan_id when 'basic' then 6990 else 44900 end,
  pix_superseded = case when provider_payment_id is not null
    then array_append(pix_superseded, provider_payment_id) else pix_superseded end,
  provider_payment_id = null, pix_copy_paste = null, pix_expires_at = null
  where status in ('open', 'failed') and plan_id in ('basic', 'pro_plus');
update plans set public = false, recommended = false, trial_days = 0, updated_at = now()
  where id in ('basic', 'pro_plus');

-- ── packs ────────────────────────────────────────────────────────────────────

create table if not exists ai_packs (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (char_length(name) between 2 and 40),
  price_cents int not null check (price_cents between 100 and 10000000),
  conversations int not null check (conversations between 1 and 100000),
  public boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table ai_packs enable row level security;
drop policy if exists ai_packs_read on ai_packs;
create policy ai_packs_read on ai_packs for select using (true);
drop policy if exists ai_packs_control on ai_packs;
create policy ai_packs_control on ai_packs for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on ai_packs to vendua_app;

insert into ai_packs (id, name, price_cents, conversations, sort) values
  ('ai_100', '+100 conversas', 3990, 100, 1)
on conflict (id) do nothing;

alter table invoices drop constraint if exists invoices_kind_check;
alter table invoices add constraint invoices_kind_check
  check (kind in ('period', 'upgrade', 'ai_pack'));
alter table invoices add column if not exists ai_pack_id text references ai_packs (id);
-- what the pack gave when it was bought: a later change to the catalog doesn't touch it
alter table invoices add column if not exists ai_conversations int
  check (ai_conversations between 1 and 100000);
alter table invoices drop constraint if exists invoices_ai_pack_kind;
alter table invoices add constraint invoices_ai_pack_kind
  check ((kind = 'ai_pack') = (ai_pack_id is not null and ai_conversations is not null));
create index if not exists invoices_open_ai_pack on invoices (created_at)
  where status = 'open' and kind = 'ai_pack';

-- ── the store's conversations ────────────────────────────────────────────────

create table if not exists ai_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  invoice_id uuid not null unique references invoices (id) on delete cascade,
  conversations int not null check (conversations between 1 and 100000),
  created_at timestamptz not null default now()
);
create index if not exists ai_credits_by_tenant on ai_credits (tenant_id);

create table if not exists ai_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- the Vendedor's own id for the conversation (its thread); counted once per 24 h from its start
  subject_key text not null check (char_length(subject_key) between 1 and 200),
  -- what paid for it: the month's allowance, the trial's, or a pack
  source text not null check (source in ('plan', 'trial', 'pack')),
  started_at timestamptz not null default now()
);
create index if not exists ai_conversations_by_subject
  on ai_conversations (tenant_id, subject_key, started_at desc);
create index if not exists ai_conversations_by_time on ai_conversations (tenant_id, started_at);

do $$
declare
  t text;
begin
  foreach t in array array['ai_credits', 'ai_conversations']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)',
      t
    );
    execute format('drop policy if exists control_access on %I', t);
    execute format(
      'create policy control_access on %I for all
         using (current_setting(''vendua.control'', true) = ''1'')
         with check (current_setting(''vendua.control'', true) = ''1'')',
      t
    );
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;
