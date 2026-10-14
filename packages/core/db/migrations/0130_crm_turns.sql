-- 0130_crm_turns.sql — the CRM agent on Agent Runtime v3 (ADR 0030 steps 2–4): one row per
-- finished turn of a CRM actor (crm, crm-discovery, crm-strategist), written by the host's turn
-- hooks in the transaction that ends the turn. It is a projection of agent_events, rebuildable, and
-- what the CRM's activity list, metrics, cost caps and reports read in place of agent_runs. Platform
-- data like the rest of the CRM: the staff_all policy.
--   kind    the job the turn did (triage, reply, outreach, discovery, strategist)
--   source  why it ran, in agent_runs' words (inbound, callback, followup, first_contact, staff,
--           regenerate, brief, weekly), so copied history and new turns read alike
--   acted   a lead-facing action landed (a message, a draft, a handoff…)

create table if not exists crm_turns (
  turn_id uuid primary key,
  actor_id uuid not null,
  agent_id text not null check (char_length(agent_id) <= 40),
  kind text not null check (kind in ('triage', 'reply', 'outreach', 'discovery', 'strategist')),
  source text not null check (char_length(source) between 1 and 120),
  lead_id uuid references leads (id) on delete set null,
  brief_id uuid references discovery_briefs (id) on delete set null,
  status text not null check (status in ('done', 'failed')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  steps int not null default 0 check (steps >= 0),
  acted boolean not null default false,
  leads_created int not null default 0 check (leads_created >= 0),
  tokens_in int not null default 0 check (tokens_in >= 0),
  tokens_out int not null default 0 check (tokens_out >= 0),
  cost_cents int not null default 0 check (cost_cents >= 0),
  error text check (char_length(error) <= 1000),
  params jsonb not null default '{}'::jsonb check (octet_length(params::text) <= 8000)
);
create index if not exists crm_turns_lead on crm_turns (lead_id, finished_at desc)
  where lead_id is not null;
create index if not exists crm_turns_kind on crm_turns (kind, finished_at desc);
create index if not exists crm_turns_finished on crm_turns (finished_at desc);
create index if not exists crm_turns_brief on crm_turns (brief_id, finished_at desc)
  where brief_id is not null;

do $$
begin
  execute format('alter table %I enable row level security', 'crm_turns');
  execute format('drop policy if exists staff_all on %I', 'crm_turns');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'crm_turns'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'crm_turns');
end
$$;

-- the history the projection starts from: finished runs of the old runtime, so cost caps, metrics
-- and reports read one table across the cutover (agent_runs is dropped in a later migration)
insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, brief_id, status,
                       started_at, finished_at, steps, acted, leads_created, tokens_in, tokens_out,
                       cost_cents, error, params)
select r.id, r.id, 'crm', r.kind, coalesce(r.source, 'agent'),
       case when exists (select 1 from leads l where l.id = r.lead_id) then r.lead_id end,
       (select b.id from discovery_briefs b where b.id::text = r.params->>'briefId'),
       r.status, coalesce(r.started_at, r.created_at), coalesce(r.finished_at, r.created_at),
       0, false,
       -- the dead-brief pause counts these: a discovery run's leads, from its journal
       (select count(*)::int from jsonb_array_elements(
          case when jsonb_typeof(r.steps) = 'array' then r.steps else '[]'::jsonb end) s
        where s->>'name' = 'create_lead' and s->'out'->'lead'->>'id' is not null),
       coalesce(r.tokens_in, 0), coalesce(r.tokens_out, 0), coalesce(r.cost_cents, 0),
       left(r.error, 1000),
       case when octet_length(r.params::text) <= 8000 then r.params else '{}'::jsonb end
from agent_runs r
where r.status in ('done', 'failed')
on conflict (turn_id) do nothing;

-- memory written by a turn names the turn (crm_turns.turn_id), not an agent_runs row
alter table agent_memory_items drop constraint if exists agent_memory_items_source_run_id_fkey;
alter table lead_facts drop constraint if exists lead_facts_source_run_id_fkey;
