-- 0019_lead_agent_plan.sql — lead-scoped negotiation plan. A lead carries a
-- checklist the agent writes (steps with todo|done|skip status) and ticks
-- off across replies — the "goal updating" surface: methodology stages become
-- rows the model checks off, surviving between runs. Run-scoped `plan`/`book`
-- memory dies with the run; this persists on the lead, rides row_to_json into
-- run context, and shows on the board via the lead view.
alter table leads
  add column if not exists agent_plan jsonb not null default '[]'::jsonb;
