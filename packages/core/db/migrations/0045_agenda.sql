-- ADR 0016: every future touch on a lead lives in agent_wakeups; leads.next_action_at is
-- a mirror of the earliest pending one. Existing dates become agenda entries.
-- legacy 'agent' was the ambiguous 0025 marker — kept as a promise (requested)

insert into agent_wakeups (lead_id, kind, at, focus, requested, created_by)
select l.id, 'outreach', l.next_action_at,
  case coalesce(l.next_action_source, 'staff')
    when 'staff' then 'a equipe marcou esta data para retomar o lead'
    when 'requested' then 'o lead pediu retorno nesta data'
    when 'agent' then 'o lead pediu retorno nesta data'
    when 'cadence' then 'sem resposta desde o último envio — retome com um gancho novo'
    else 'retomar a conversa na data que você marcou'
  end,
  coalesce(l.next_action_source, 'staff') in ('requested', 'agent'),
  case when coalesce(l.next_action_source, 'staff') = 'staff' then 'staff' else 'agent' end
from leads l
where l.next_action_at is not null
  and l.archived_at is null and l.unsubscribed_at is null
  and not exists (
    select 1 from agent_wakeups w
    where w.lead_id = l.id and w.status = 'pending' and w.at = l.next_action_at
  )
on conflict do nothing;

update leads l set (next_action_at, next_action_source) = (
  select w.at,
    case when w.created_by = 'staff' then 'staff' when w.requested then 'requested' else 'auto' end
  from agent_wakeups w
  where w.lead_id = l.id and w.status = 'pending'
  order by w.at limit 1
)
where l.next_action_at is not null
   or exists (select 1 from agent_wakeups w where w.lead_id = l.id and w.status = 'pending');
