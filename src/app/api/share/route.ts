import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { route } from "@/lib/llm";
import { DEFAULT_BOARD_SLUG, getBoards, persistCapture } from "@/lib/ingest";
import type { CaptureFields } from "@/types/llm";

/**
 * Handles the PWA's Web Share Target: `Share to` from Android's share sheet
 * (e.g. long-press a WhatsApp message → Share → this app) posts here as
 * multipart form data per the manifest's share_target config (see
 * public/manifest.webmanifest).
 *
 * iOS PWAs cannot register as share targets — there is no equivalent route
 * for iPhone. That path is an iOS Shortcut instead (see README). This is a
 * stated limit, not a bug.
 *
 * Requires the sharer to be logged in (magic-link session cookie) since
 * there's no WhatsApp phone number to attach the capture to otherwise.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("wb_user_id")?.value;

  const form = await req.formData();
  const title = form.get("title")?.toString() ?? "";
  const text = form.get("text")?.toString() ?? "";
  const url = form.get("url")?.toString() ?? "";
  const rawText = [title, text, url].filter(Boolean).join(" — ");

  if (!userId || !rawText.trim()) {
    return NextResponse.redirect(new URL("/boards?shared=0", req.url), 303);
  }

  const db = createServiceClient();
  const boards = await getBoards(db, userId);

  // Same route() + persist path as src/lib/ingest.ts's handleCapture(), with
  // source: "share" instead of "whatsapp". A share is inherently something
  // to save, so if the router comes back without capture fields (e.g. it
  // read the text as a question), fall back to saving it as-is to the
  // default board rather than dropping it.
  const routed = await route(rawText, boards).catch(() => null);
  const capture: CaptureFields = routed?.capture ?? {
    board: DEFAULT_BOARD_SLUG,
    title: title || text || url,
    due_at: null,
    amount_minor: null,
    currency: null,
    tags: [],
  };

  await persistCapture(db, { id: userId }, boards, rawText, capture, { source: "share" });

  return NextResponse.redirect(new URL("/boards?shared=1", req.url), 303);
}
