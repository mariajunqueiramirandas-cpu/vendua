-- H5: an upgrade in the middle of a paid period is charged pro rata before it applies.
--
-- invoices.kind: 'period' is a month of the plan (unique per period_start, as before);
-- 'upgrade' is a one-off charge for the price difference until the current period ends
-- (period_start = when it was asked, period_end = the paid period's end). It never reminds,
-- never moves the subscription's period, and is void once that period ends unpaid.
alter table invoices
  add column if not exists kind text not null default 'period'
    check (kind in ('period', 'upgrade')),
  -- Pix payments that landed short of the invoice (a QR issued before a price rise): the
  -- invoice stays open and the team refunds or settles the difference by hand
  add column if not exists short_payments text[] not null default '{}';

-- the upgrade waiting for its invoice; plan_id stays the paid plan until it is paid
alter table subscriptions
  add column if not exists upgrade_plan_id text references plans (id),
  add column if not exists upgrade_invoice_id uuid references invoices (id) on delete set null;

create index if not exists invoices_open_upgrade on invoices (period_end)
  where status = 'open' and kind = 'upgrade';
