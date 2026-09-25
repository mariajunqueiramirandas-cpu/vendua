-- Cancel queued runs on unsubscribed leads (unsubscribed_at never lifts; 'off'/archived stay queued).
update agent_runs
set status = 'canceled', finished_at = now(), error = 'descadastrado'
where status = 'queued'
  and lead_id in (select id from leads where unsubscribed_at is not null);
