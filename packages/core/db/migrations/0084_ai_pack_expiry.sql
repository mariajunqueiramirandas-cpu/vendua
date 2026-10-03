-- 0084_ai_pack_expiry.sql — a pack's conversations last 30 days from its payment (the owner's
-- decision, ADR 0032). Each pack conversation names the credit that paid for it, so what is left
-- of each pack (and what lapses) is exact; the soonest to lapse is spent first.
--   ai_credits.expires_at       — when what is left of the pack stops counting
--   ai_conversations.credit_id  — the pack that paid for a 'pack' conversation

alter table ai_credits add column if not exists expires_at timestamptz;
update ai_credits set expires_at = created_at + interval '30 days' where expires_at is null;
alter table ai_credits alter column expires_at set not null;
create index if not exists ai_credits_live on ai_credits (tenant_id, expires_at);

alter table ai_conversations
  add column if not exists credit_id uuid references ai_credits (id) on delete set null;
create index if not exists ai_conversations_by_credit on ai_conversations (credit_id)
  where credit_id is not null;

-- pack conversations from before this column: each store's, oldest first, fill its credits oldest
-- first, so a pack already spent stays spent
with conv as (
  select id, tenant_id, row_number() over (partition by tenant_id order by started_at, id) as n
  from ai_conversations where source = 'pack' and credit_id is null
), cred as (
  select id, tenant_id,
         sum(conversations) over (partition by tenant_id order by created_at, id) - conversations as lo,
         sum(conversations) over (partition by tenant_id order by created_at, id) as hi
  from ai_credits
)
update ai_conversations a set credit_id = cred.id
from conv join cred on cred.tenant_id = conv.tenant_id and conv.n > cred.lo and conv.n <= cred.hi
where a.id = conv.id;
