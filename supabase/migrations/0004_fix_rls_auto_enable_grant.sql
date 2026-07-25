-- 0003's REVOKE ... FROM anon, authenticated was a no-op: Postgres grants
-- EXECUTE on new functions to PUBLIC by default, and anon/authenticated
-- inherit through PUBLIC rather than holding an explicit grant. Revoking
-- from the named roles left the PUBLIC grant untouched, so the advisor
-- still flagged it. Revoke from PUBLIC directly, then re-grant to the roles
-- that actually need it (service_role, postgres) so provisioning tooling
-- that depends on this helper keeps working.
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace
  ) then
    revoke execute on function public.rls_auto_enable() from public;
    grant execute on function public.rls_auto_enable() to service_role, postgres;
  end if;
end $$;
