-- =============================================================================
-- 0010 Platform hardening
-- Managed platforms such as Supabase create extra roles (anon, authenticated)
-- and expose the public schema through an automatic REST API. This app does
-- not use that API. Remove every privilege those roles might have so the only
-- way to reach data is the application role (erp_app) under RLS.
-- (Also disable the Data API in the Supabase dashboard — see docs/DEPLOYMENT.md.)
-- =============================================================================
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke all on schema app from %I', r);
      execute format('revoke all on all functions in schema app from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
    end if;
  end loop;
end $$;

-- Functions created later must not be executable by PUBLIC by default.
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;
