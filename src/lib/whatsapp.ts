import crypto from "node:crypto";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * Verifies the X-Hub-Signature-256 header Meta sends on every webhook POST.
 * Reject anything that doesn't match — the webhook endpoint is public and
 * will get probed.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) throw new Error("Missing META_APP_SECRET");

  const expected =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Marks an inbound message as read. This is the near-silent acknowledgment
 * primitive: a status call, not an outbound send. Unverified assumption
 * (see plan §Acknowledgment strategy) that this is not billed after 1 Oct —
 * confirm with Meta support before relying on it at scale.
 */
export async function markAsRead(messageId: string): Promise<void> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requireEnv("WHATSAPP_TOKEN");

  await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

/**
 * Sends a text reply. Every call here is a billed message after 1 Oct 2026
 * (see plan §Outbound replies become a cost centre) — use only for query
 * answers, low-confidence-capture clarifications, and commands, never as a
 * routine capture acknowledgment.
 */
export async function sendText(toE164: string, body: string): Promise<void> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requireEnv("WHATSAPP_TOKEN");

  const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed ${res.status}: ${detail.slice(0, 500)}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// ── Inbound webhook payload shape (subset we care about) ───────────────────

export interface InboundTextMessage {
  from: string; // sender's phone number, no leading +
  id: string; // wa_message_id
  timestamp: string;
  type: "text";
  text: { body: string };
}

export interface WhatsAppWebhookPayload {
  entry: {
    changes: {
      value: {
        messages?: InboundTextMessage[];
      };
    }[];
  }[];
}

export function extractTextMessages(payload: WhatsAppWebhookPayload): InboundTextMessage[] {
  const out: InboundTextMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (msg.type === "text") out.push(msg);
      }
    }
  }
  return out;
}
