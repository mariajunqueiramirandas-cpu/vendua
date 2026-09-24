-- Cache-read input tokens per run: the billing-type split the cost audit
-- needs (fresh input vs provider cache hits) alongside tokens_in/tokens_out.
-- Anthropic cache-write tokens stay journal-only — they're premium-priced
-- creation, not the discount this column tracks.
alter table agent_runs add column if not exists tokens_cached int not null default 0;
