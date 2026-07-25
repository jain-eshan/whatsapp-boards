import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { hybridSearch } from "@/lib/search";

/**
 * Web app's search-as-you-type endpoint. Uses the same hybridSearch() as
 * the WhatsApp QUERY intent (src/lib/ingest.ts's handleQuery), so search
 * behaves identically whether you're typing here or asking the bot — see
 * plan §Search: one model does the whole hybrid.
 */
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("wb_user_id")?.value;
  if (!userId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q");
  if (!q?.trim()) return NextResponse.json([]);

  const db = createServiceClient();
  try {
    const results = await hybridSearch(db, userId, q);
    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
