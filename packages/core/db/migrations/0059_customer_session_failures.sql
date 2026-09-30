-- /customer/session (phone + order number) mints a customer token; order numbers are
-- sequential, so wrong guesses are counted per (tenant, phone) and capped (SEC H2).
create table if not exists customer_session_failures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone text not null check (char_length(phone) between 10 and 11),
  created_at timestamptz not null default now()
);
create index if not exists customer_session_failures_by_phone
  on customer_session_failures (tenant_id, phone, created_at desc);

do $$
declare
  t text;
  tenant_tables text[] := array['customer_session_failures'];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)',
      t
    );
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;
