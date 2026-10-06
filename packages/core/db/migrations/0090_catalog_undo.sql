-- 0090_catalog_undo.sql — deletes a merchant can take back (docs/merchant-admin-design.md §2.2.1).
--   products.deleted_at / deleted_status — "apagar produto" is a soft delete: past orders keep their
--     lines and reports their link, and undo restores the status it had. A deleted product is always
--     archived (the trigger below, whoever writes it), so every read that skips archived products —
--     the storefront, search, carts, checkout, kits, the Vendedor — skips deleted ones too.
--   coupons.archived_at — "apagar cupom" archives it: inactive and off the list, its redemptions
--     (and the reports built on them) stay.

alter table products
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_status text
    check (deleted_status in ('active', 'sold_out', 'archived'));

create or replace function products_deleted_stay_archived() returns trigger
language plpgsql as $$
begin
  if new.deleted_at is not null then
    new.status := 'archived';
  end if;
  return new;
end $$;

drop trigger if exists products_deleted_stay_archived on products;
create trigger products_deleted_stay_archived before insert or update on products
  for each row execute function products_deleted_stay_archived();

alter table coupons add column if not exists archived_at timestamptz;
