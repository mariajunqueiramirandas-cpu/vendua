-- 0093_orders_qol.sql — handling orders day to day: "atrasou" and "estornado" reach the shopper
-- from the store's own WhatsApp, and "muitos pedidos agora" ends by itself.

-- Two order messages can repeat on one order (each delay, each refund). Their occurrence follows a
-- colon in `event` ('delayed:1759787400000', 'refunded:2500'), so store_wa_messages_once still
-- keeps every other step to one message per order and a replay of the same occurrence to none.
alter table store_wa_messages drop constraint if exists store_wa_messages_event_check;
alter table store_wa_messages add constraint store_wa_messages_event_check
  check (event ~ '^[a-z_]{1,30}(:[0-9]{1,20})?$');

alter table store_whatsapp drop constraint if exists store_whatsapp_events_check;
alter table store_whatsapp add constraint store_whatsapp_events_check
  check (events <@ array['placed', 'paid', 'confirmed', 'delayed', 'preparing', 'ready',
                         'out_for_delivery', 'delivered', 'cancelled', 'refunded']);
alter table store_whatsapp alter column events
  set default array['placed', 'paid', 'confirmed', 'delayed', 'ready', 'out_for_delivery',
                    'cancelled', 'refunded'];
-- both answer something the store itself just did: on for the stores that already send, like
-- the steps they chose (each can still turn them off)
update store_whatsapp set events = events || array['delayed']
  where not ('delayed' = any(events));
update store_whatsapp set events = events || array['refunded']
  where not ('refunded' = any(events));

-- "muitos pedidos agora" until this moment; the admin sweep sets the store back to normal then
alter table store_settings add column if not exists demand_until timestamptz;

-- Início's "a comanda não imprimiu": the store's recent failures
create index if not exists print_jobs_failed on print_jobs (tenant_id, finished_at)
  where status = 'failed';
