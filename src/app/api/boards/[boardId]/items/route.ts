import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Items for one board, scoped to the logged-in user. Reads the stub
 * wb_user_id cookie set at /auth/verify (see that file's note on why this
 * isn't a real Supabase session yet) and filters explicitly by user_id as
 * a substitute for RLS until that's wired up.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;
  const cookieStore = await cookies();
  const userId = cookieStore.get("wb_user_id")?.value;
  if (!userId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const db = createServiceClient();
  const { data, error } = await db
    .from("items")
    .select("id, board_id, raw_text, title, due_at, amount_minor, currency, source, created_at")
    .eq("board_id", boardId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
