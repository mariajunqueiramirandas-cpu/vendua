-- 0044_instagram_channel.sql — Instagram DMs through the ig-sidecar (services/ig-sidecar):
-- a thread channel, an integration kind, and the sidecar's session store.
alter table lead_threads drop constraint if exists lead_threads_channel_check;
alter table lead_threads add constraint lead_threads_channel_check
  check (channel in ('email', 'whatsapp', 'instagram', 'manual'));

alter table control_integrations drop constraint if exists control_integrations_kind_check;
alter table control_integrations add constraint control_integrations_kind_check
  check (kind in ('llm', 'email', 'whatsapp', 'instagram', 'discovery'));

-- Core owns the credential so the sidecar stays stateless across redeploys.
-- `device` (the Android identity from the mobile login fallback) survives logout
-- so a re-login looks like the same phone; `session` is wiped.
create table if not exists ig_auth_state (
  account_id text primary key,
  session jsonb,
  device jsonb,
  updated_at timestamptz not null default now()
);

do $$
begin
  execute format('alter table %I enable row level security', 'ig_auth_state');
  execute format('drop policy if exists staff_all on %I', 'ig_auth_state');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'ig_auth_state'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'ig_auth_state');
end
$$;
