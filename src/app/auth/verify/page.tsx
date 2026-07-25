import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Landing page for the magic link sent by the `login` WhatsApp command
 * (see src/lib/commands.ts's handleLogin). Validates the single-use token,
 * establishes a Supabase auth session, and redirects into the boards view.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <ErrorState message="Missing token." />;
  }

  const db = createServiceClient();
  const { data: tokenRow } = await db
    .from("magic_link_tokens")
    .select("user_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (!tokenRow) return <ErrorState message="This link is invalid." />;
  if (tokenRow.used_at) return <ErrorState message="This link has already been used." />;
  if (new Date(tokenRow.expires_at) < new Date()) {
    return <ErrorState message="This link has expired. Message the bot 'login' for a new one." />;
  }

  await db
    .from("magic_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);

  // STUB SESSION: an httpOnly cookie naming the user id, read by
  // src/app/boards/page.tsx via the service-role client (which bypasses
  // RLS by design). This is enough to run the app end to end without a
  // Supabase auth JWT secret on hand, but it is not a substitute for real
  // Supabase auth. Before this pilot has real user data worth protecting:
  // replace with a signed Supabase session (custom JWT via the project's
  // JWT secret, or Supabase's phone-auth flow) so that auth.uid() resolves
  // in RLS policies and the client can query Postgres directly instead of
  // going through server components with the service key.
  const cookieStore = await cookies();
  cookieStore.set("wb_user_id", tokenRow.user_id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  redirect("/boards");
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <p className="text-center text-sm text-neutral-500">{message}</p>
    </div>
  );
}
