-- 0140_agent_events_partition_rls.sql — agent_events' partitions (0081, 0130) were made with
-- `like agent_events`, which copies no row security, and the default privileges gave vendua_app
-- DML on each: a statement naming a partition read and wrote every store's events. Core only
-- ever goes through agent_events, whose policies (and grants) are the ones checked for a
-- partition reached through it, so each partition is closed to the app role: RLS on with no
-- policy, and no grants. The function closes each month it makes the same way.

do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'agent_events'::regclass
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from vendua_app', t);
  end loop;
end
$$;

create or replace function agent_events_partition(month date) returns text
language plpgsql security definer set search_path = public as $$
declare
  start date := date_trunc('month', month)::date;
  stop date := (date_trunc('month', month) + interval '1 month')::date;
  name text := format('agent_events_y%sm%s', to_char(start, 'YYYY'), to_char(start, 'MM'));
begin
  if to_regclass(name) is not null then
    return name;
  end if;
  perform pg_advisory_xact_lock(hashtext('vendua.agent_events_partition'));
  -- a query, not to_regclass: an advisory lock doesn't refresh the catalog cache, a snapshot does
  if exists (select 1 from pg_class where relname = name and relnamespace = 'public'::regnamespace) then
    return name;
  end if;
  -- rows that landed in the default partition for this month move first, or attaching fails
  execute format('create table %I (like agent_events including defaults including constraints)', name);
  execute format('alter table %I enable row level security', name);
  execute format('revoke all on %I from vendua_app', name);
  execute format(
    'with moved as (delete from agent_events_default where at >= %L and at < %L returning *)
     insert into %I select * from moved',
    start, stop, name
  );
  execute format('alter table agent_events attach partition %I for values from (%L) to (%L)', name, start, stop);
  return name;
end
$$;
revoke all on function agent_events_partition(date) from public;
grant execute on function agent_events_partition(date) to vendua_app;
