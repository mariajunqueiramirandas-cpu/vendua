-- 0130_agent_events_partition_lock.sql — agent_events_partition (0081) checked for the month's
-- table and then created it, so two Cores asking at once (a deploy's overlap at a month's turn,
-- a second replica) could both find none and one would fail on the create. The check is repeated
-- under a transaction-scoped advisory lock. Same signature, same grants.

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
