import Link from "next/link";
import BoardsApp from "@/components/BoardsApp";
import { createServiceClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

/**
 * The web app's home: board list + item list + search, per plan §The web
 * app is the product surface. This is where reading and organizing happen,
 * because WhatsApp is bad at both — capture stays in the chat.
 *
 * Auth is still a stub (see src/app/auth/verify/page.tsx TODO), so this
 * reads a plain `wb_user_id` cookie set at verify time rather than a real
 * Supabase session. Swap for supabase.auth session lookup once the magic
 * link flow signs a real JWT.
 */
export default async function BoardsPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("wb_user_id")?.value;

  if (!userId) {
    return <LoggedOutState />;
  }

  const db = createServiceClient();
  const { data: boards } = await db
    .from("boards")
    .select("id, name, slug, kind, position")
    .eq("user_id", userId)
    .order("position");

  return <BoardsApp userId={userId} initialBoards={boards ?? []} />;
}

function LoggedOutState() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-medium">Not logged in</p>
      <p className="max-w-sm text-sm text-muted">
        Message the bot on WhatsApp with <span className="font-mono">login</span> to get a link
        into your boards.
      </p>
      <Link href="/" className="mt-4 text-sm underline underline-offset-4">
        Back home
      </Link>
    </div>
  );
}
