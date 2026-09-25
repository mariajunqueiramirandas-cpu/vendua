-- ADR 0016: why a run exists becomes columns (source, promised, priority) instead of
-- params markers (params.auto / params.origin / "unmarked = promise").

alter table agent_runs add column if not exists source text;
alter table agent_runs add column if not exists promised boolean not null default false;
alter table agent_runs add column if not exists priority smallint not null default 4;
alter table agent_inbox add column if not exists source text;
alter table agent_inbox add column if not exists promised boolean not null default false;

-- legacy markers → source. 'agent' was the ambiguous 0025 marker, treated as a promise;
-- unmarked lead-bound outreach came from a promised date (staff/requested next action).
update agent_runs set source = case
    when params->>'origin' = 'inbound' then 'inbound'
    when params->>'origin' = 'staff' then 'staff'
    when params->>'auto' in ('first-contact', 'discovery') then 'first_contact'
    when params->>'auto' = 'regenerate' then 'regenerate'
    when params->>'auto' = 'brief' or (kind = 'discovery' and params ? 'briefId') then 'brief'
    when params->>'auto' = 'weekly' then 'weekly'
    when params->>'auto' = 'agent' then 'callback'
    when params ? 'auto' then 'followup'
    when params ? 'wakeupId' then 'callback'
    when kind = 'outreach' and lead_id is not null then 'callback'
    else 'staff'
  end
where source is null;

update agent_inbox set source = case
    when kind = 'staff' then 'staff'
    when kind = 'inbound' or payload->'params'->>'origin' = 'inbound' then 'inbound'
    when payload->'params'->>'origin' = 'staff' then 'staff'
    when payload->'params'->>'auto' in ('first-contact', 'discovery') then 'first_contact'
    when payload->'params'->>'auto' = 'regenerate' or payload->>'auto' = 'regenerate' then 'regenerate'
    when payload->'params'->>'auto' = 'agent' then 'callback'
    when payload->'params' ? 'auto' then 'followup'
    when payload->'params' ? 'wakeupId' then 'callback'
    when payload->>'requestedKind' = 'outreach' then 'callback'
    else 'staff'
  end
where source is null;

update agent_runs set promised = (source = 'callback');
update agent_inbox set promised = (source = 'callback');
update agent_runs set priority = case source
    when 'inbound' then 0 when 'callback' then 1 when 'staff' then 2 when 'regenerate' then 2
    when 'first_contact' then 3 when 'followup' then 4 when 'brief' then 6 else 7
  end;

-- the markers are gone from the model; keep params for what they configure
update agent_runs set params = params - 'auto' - 'origin' where params ?| array['auto', 'origin'];
update agent_inbox set payload = jsonb_set(payload, '{params}', (payload->'params') - 'auto' - 'origin')
where payload->'params' ?| array['auto', 'origin'];
update agent_inbox set payload = payload - 'auto' where payload ? 'auto';

-- 'staff' = neither automated nor retired by an inbound: the safe reading for a row no
-- producer described (every producer states its source through dispatch.ts)
alter table agent_runs alter column source set default 'staff';
alter table agent_inbox alter column source set default 'staff';
alter table agent_runs alter column source set not null;
alter table agent_inbox alter column source set not null;
alter table agent_runs add constraint agent_runs_source_check check (source in
  ('inbound', 'callback', 'staff', 'regenerate', 'first_contact', 'followup', 'brief', 'weekly'));
alter table agent_inbox add constraint agent_inbox_source_check check (source in
  ('inbound', 'callback', 'staff', 'regenerate', 'first_contact', 'followup', 'brief', 'weekly'));

-- claim scans queued rows by priority, then age
drop index if exists agent_runs_queue;
create index if not exists agent_runs_queue on agent_runs (priority, created_at) where status = 'queued';
