-- Menu import on the merchant's own domain (docs/menu-import.md §4.4, custom domains).
--
-- A pasted host that no adapter matches is accepted with `platform` null and `source_ref` the
-- host; the read job places it on a platform (custom-domain.ts) and sets both before reading.
-- `source_ref` holds a whole hostname until then (up to 253 characters).

alter table menu_imports alter column platform drop not null;

alter table menu_imports drop constraint if exists menu_imports_source_ref_check;
alter table menu_imports add constraint menu_imports_source_ref_check
  check (char_length(source_ref) <= 253);
