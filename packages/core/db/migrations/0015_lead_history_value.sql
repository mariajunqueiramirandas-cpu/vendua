-- 0015_lead_history_value.sql — deal-value snapshot per state transition.
-- Stamps the lead's deal_value_cents onto the history row so won30d reports
-- the value effective at win time — editing the deal later can't rewrite
-- already-reported revenue.

alter table lead_state_history add column if not exists value_cents int;

-- Freeze pre-column rows at the best estimate available — the deal value
-- current at migration — so wins already reported keep reporting the same
-- number and later edits can't move it. A null deal value stays null
-- (unknown at transition), which after this stamp reads as "captured null",
-- not "missing column", so won30d can drop its coalesce entirely.
update lead_state_history h
set value_cents = l.deal_value_cents
from leads l
where h.lead_id = l.id and h.value_cents is null;
