-- 0099_table_qr.sql — ordering from the table's QR code (ADR 0036).
--   pdv_tables.qr_rev            — part of the table's signed QR token: bumping it ("gerar novo
--                                  QR") makes the printed one stop working
--   store_settings.pdv_qr_orders — the store takes orders from its tables' QR codes

alter table pdv_tables add column if not exists qr_rev int not null default 1
  check (qr_rev between 1 and 1000000);
alter table store_settings add column if not exists pdv_qr_orders boolean not null default true;
