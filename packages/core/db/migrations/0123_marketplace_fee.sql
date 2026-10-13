-- 0123_marketplace_fee.sql — "quanto o site já poupou" (Início): the commission the store pays
-- the delivery app it also sells on, as the owner typed it, in basis points (27% = 2700). Core
-- multiplies it by the store's own-site sales; null = not told, the card asks; 0 = no app.
alter table store_settings add column if not exists marketplace_fee_bp int
  check (marketplace_fee_bp = 0 or marketplace_fee_bp between 100 and 5000);
