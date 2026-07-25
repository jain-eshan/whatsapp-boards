import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-only code (webhook, ingest pipeline).
 * Bypasses RLS by design — never import this into client components or
 * expose SUPABASE_SERVICE_ROLE_KEY to the browser bundle.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false },
  });
}
