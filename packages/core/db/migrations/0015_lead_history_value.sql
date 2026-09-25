-- Deal-value snapshot per state transition — later edits can't rewrite already-reported revenue.

alter table lead_state_history add column if not exists value_cents int;

-- Backfill pre-column rows at the deal value current now; a null deal stays null ("captured null").
update lead_state_history h
set value_cents = l.deal_value_cents
from leads l
where h.lead_id = l.id and h.value_cents is null;
