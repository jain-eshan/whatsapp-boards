import { NextRequest, NextResponse } from "next/server";

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
  const form = await req.formData();
  const title = form.get("title")?.toString() ?? "";
  const text = form.get("text")?.toString() ?? "";
  const url = form.get("url")?.toString() ?? "";

  const rawText = [title, text, url].filter(Boolean).join(" — ");

  // TODO: resolve the logged-in user from the Supabase session cookie, run
  // the same route() + persist path as src/lib/ingest.ts's handleCapture(),
  // with source: "share" instead of "whatsapp". Not wired yet — this route
  // defines the contract (multipart form → single capture) that the PWA
  // manifest and Android's share sheet expect.
  console.log("share-target received:", rawText);

  return NextResponse.redirect(new URL("/boards?shared=1", req.url), 303);
}
