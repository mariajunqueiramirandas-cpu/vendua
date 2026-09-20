-- 0015_lead_history_value.sql — deal-value snapshot per state transition.
-- Stamps the lead's deal_value_cents onto the history row so won30d reports
-- the value effective at win time — editing the deal later can't rewrite
-- already-reported revenue.

alter table lead_state_history add column if not exists value_cents int;

-- No backfill: copying today's deal_value_cents onto old rows would fabricate
-- history. Readers coalesce value_cents → deal_value_cents for pre-column rows.
