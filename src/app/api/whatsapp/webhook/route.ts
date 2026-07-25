import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifyWebhookSignature, extractTextMessages } from "@/lib/whatsapp";
import { processInboundMessage } from "@/lib/ingest";
import type { WhatsAppWebhookPayload } from "@/lib/whatsapp";

/**
 * GET: Meta's one-time webhook verification challenge, done when the
 * webhook URL is registered in the Meta app dashboard.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST: inbound message delivery.
 *
 * Returns 200 immediately after signature verification and enqueuing the
 * async work — Meta's retry behaviour on slow responses is what causes
 * duplicate deliveries (see plan §Build order, step 3). Idempotency is
 * still enforced downstream in processInboundMessage() via ingest_log,
 * because "immediately" here just means "before processing finishes," not
 * "guaranteed exactly once."
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad payload", { status: 400 });
  }

  const messages = extractTextMessages(payload);

  // Respond 200 now; process after the response is sent. On Vercel's
  // serverless runtime a bare fire-and-forget promise can be killed the
  // moment the response flushes — after() is what actually keeps the
  // function alive for this work. Failures land in dead_letter (see
  // src/lib/ingest.ts) rather than being lost or blocking Meta's delivery
  // on our processing time.
  for (const msg of messages) {
    after(() =>
      processInboundMessage(msg).catch((err) => {
        console.error(`Failed to process message ${msg.id}:`, err);
      })
    );
  }

  return new NextResponse("OK", { status: 200 });
}
