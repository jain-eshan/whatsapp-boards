-- Fixes from the security advisor after applying 0001/0002.
--
-- match_items_dense / match_items_sparse: mutable search_path lets a caller
-- with CREATE privilege on some schema earlier in search_path shadow objects
-- these functions reference (e.g. a fake "items" table). Pin it explicitly.
alter function match_items_dense(vector(1024), uuid, int) set search_path = public, extensions;
alter function match_items_sparse(jsonb, uuid, int) set search_path = public, extensions;

-- rls_auto_enable: a Supabase dashboard-provisioned helper (not written by
-- this project) that auto-enables RLS on new tables. It's SECURITY DEFINER
-- and was callable via RPC by anon/authenticated, which is unnecessary
-- surface area — it's a provisioning helper, not part of this app's API.
-- Guarded because it may not exist on every environment (e.g. a project
-- created purely via CLI rather than the dashboard).
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace
  ) then
    revoke execute on function public.rls_auto_enable() from anon, authenticated;
  end if;
end $$;

-- Not fixed here, by design:
--
-- dead_letter / ingest_log / magic_link_tokens show "RLS enabled, no policy"
-- in the advisor. That's correct for these three: none of them are meant to
-- be readable via the anon/authenticated client roles at all, only via the
-- service-role key from server code (lib/ingest.ts, the webhook route,
-- magic-link issuance/verification). RLS-with-no-policy is default-deny,
-- which is the right posture — adding a policy would be adding client access
-- that shouldn't exist. Left alone intentionally, not an oversight.
--
-- extension_in_public (vector, pg_trgm) — WARN, not fixed. Moving these to a
-- dedicated schema after items.embedding/sparse_embedding already depend on
-- the `vector`/`sparsevec` types is a real migration (drop/recreate extension,
-- requalify types, update search_path everywhere) and carries downtime risk
-- for a two-column fix. Deferred past the pilot; tracked in the plan's open
-- risks, not silently dropped.
