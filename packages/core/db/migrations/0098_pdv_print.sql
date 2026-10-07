-- 0098_pdv_print.sql — the PDV prints (ADR 0035): a comanda's bill ("conferência") and the caixa's
-- report go through the print agents like order tickets.
--   print_jobs.kind  + 'bill' | 'caixa'
--   print_jobs.doc   — what to print, frozen when it was asked for (the bill or the report as Core
--                      computed it); rendered for each printer's paper when the agent claims it

alter table print_jobs drop constraint if exists print_jobs_kind_check;
alter table print_jobs add constraint print_jobs_kind_check
  check (kind in ('order', 'test', 'bill', 'caixa'));
alter table print_jobs add column if not exists doc jsonb;
alter table print_jobs drop constraint if exists print_jobs_doc_size;
alter table print_jobs add constraint print_jobs_doc_size
  check (doc is null or pg_column_size(doc) <= 262144);
