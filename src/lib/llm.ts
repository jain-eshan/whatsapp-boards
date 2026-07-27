/**
 * Single interface for every model call in the app: route(), answer(), embed().
 *
 * Model IDs come from env vars (LLM_ROUTER_MODEL, LLM_ANSWER_MODEL,
 * LLM_EMBED_MODEL) so swapping models is a config change, not a code change.
 * Do not pick a model from a benchmark blog post — build the 100-message eval
 * set from real WhatsApp data (see plan §The assignment) and measure routing
 * accuracy, field accuracy, and p95 latency on it before committing.
 *
 * All calls route through OpenRouter.
 */

import type { AnswerResult, CaptureFields, EmbedResult, RouteResult } from "@/types/llm";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function openrouterChat(params: {
  model: string;
  messages: { role: "system" | "user"; content: string }[];
  responseFormat?: "json_object";
  temperature?: number;
}): Promise<string> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.1,
      ...(params.responseFormat === "json_object"
        ? { response_format: { type: "json_object" } }
        : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter response missing message content");
  }
  return content;
}

const ROUTER_SYSTEM_PROMPT = `You classify a single WhatsApp message from a personal capture app.
Reply ONLY with JSON matching this shape:
{
  "intent": "capture" | "query" | "command",
  "confidence": number between 0 and 1,
  "capture": null | {
    "board": string,       // one of the user's existing board slugs, or a new short slug
    "title": string,       // short human-readable title
    "due_at": string|null, // ISO 8601 if a date/time is implied, else null
    "amount_minor": number|null, // integer minor units (e.g. paise) if a money amount is present
    "currency": string|null,     // ISO 4217 if amount_minor is set
    "tags": string[]
  },
  "command": null | string  // e.g. "login", "undo", "delete_my_data", "boards"
}

Rules:
- Default to "capture" on ambiguity. A wrong capture is undoable; a missed capture is not.
- Messages are frequently Hinglish or messy — parse intent, not literal English words.
- "capture" when the message states something to remember (a to-do, an expense, a note, a link).
- "query" when the message asks a question about past captures ("what did I spend on...", "find...", "what's due...").
- "command" for exact control words like login, undo, delete my data, boards.
- Set confidence low (< 0.6) when you are genuinely unsure between capture and query.`;

export async function route(
  messageText: string,
  existingBoards: { slug: string; name: string }[]
): Promise<RouteResult> {
  const model = process.env.LLM_ROUTER_MODEL || "qwen/qwen3.6-35b-a3b";
  const boardList = existingBoards.map((b) => `${b.slug} (${b.name})`).join(", ") || "none yet";

  const raw = await openrouterChat({
    model,
    responseFormat: "json_object",
    messages: [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Existing boards: ${boardList}\n\nMessage: ${messageText}`,
      },
    ],
  });

  const parsed = JSON.parse(raw) as {
    intent: RouteResult["intent"];
    confidence: number;
    capture: CaptureFields | null;
    command: string | null;
  };

  return {
    intent: parsed.intent,
    confidence: parsed.confidence,
    capture: parsed.capture ?? null,
    command: parsed.command ?? null,
  };
}

export async function answer(
  question: string,
  retrievedItems: { id: string; title: string | null; raw_text: string; created_at: string }[]
): Promise<AnswerResult> {
  const model = process.env.LLM_ANSWER_MODEL || "moonshotai/kimi-k2.5";

  const context = retrievedItems
    .map((item, i) => `[${i + 1}] (id: ${item.id}) ${item.title ?? item.raw_text} — ${item.created_at}`)
    .join("\n");

  const raw = await openrouterChat({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `You answer questions about a user's personal WhatsApp capture history using ONLY the
provided items. Cite the items you used by their id. If nothing in the provided
items answers the question, say so plainly rather than guessing. Do not
perform arithmetic over the items yourself — if the question requires totals
or sums, say the caller should use the aggregate query path instead. Reply
in the same language/register the question was asked in (Hinglish is fine).`,
      },
      {
        role: "user",
        content: `Question: ${question}\n\nRetrieved items:\n${context || "(none found)"}`,
      },
    ],
  });

  const citedItemIds = retrievedItems
    .filter((item) => raw.includes(item.id))
    .map((item) => item.id);

  return { text: raw, citedItemIds };
}

export async function embed(text: string): Promise<EmbedResult> {
  // BGE-M3 is not served over the OpenRouter chat completions API. Cloudflare
  // Workers AI hosts it directly (@cf/baai/bge-m3) with no server to run —
  // dense output only. BGE-M3's sparse output needs the raw FlagEmbedding
  // library, which isn't practically self-hostable at pilot scale; the
  // keyword side of hybrid search uses Postgres's pg_trgm instead, see
  // src/lib/search.ts and supabase/migrations/0005_trgm_search.sql.
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-m3`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cloudflare Workers AI embed ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const dense = data?.result?.data?.[0];
  if (!Array.isArray(dense)) {
    throw new Error("Cloudflare Workers AI embed response missing result.data[0]");
  }
  return { dense };
}
