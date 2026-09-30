-- CORE-PAY: the token refresh job takes a short lease on a connection (its own tx), calls
-- Mercado Pago with no row lock held, and stores the new tokens in a second tx. Two Core
-- replicas never spend the same single-use refresh token.
alter table payment_connections
  add column if not exists refreshing_until timestamptz;
