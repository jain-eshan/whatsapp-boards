import { createServiceClient } from "@/lib/supabase/server";
import { route, answer, embed } from "@/lib/llm";
import { markAsRead, sendText } from "@/lib/whatsapp";
import { hybridSearch } from "@/lib/search";
import { runCommand } from "@/lib/commands";
import type { InboundTextMessage } from "@/lib/whatsapp";

const LOW_CONFIDENCE_THRESHOLD = 0.6;
const DEFAULT_BOARD_SLUG = "inbox";

/**
 * Processes one inbound WhatsApp text message end to end: idempotency check,
 * intent routing, dispatch to capture/query/command, and acknowledgment.
 *
 * Called async, after the webhook route has already returned 200 to Meta —
 * see src/app/api/whatsapp/webhook/route.ts. On any failure, the message is
 * written to dead_letter with the raw payload so nothing typed is silently
 * lost, then re-thrown so the caller's logs show it.
 */
export async function processInboundMessage(msg: InboundTextMessage): Promise<void> {
  const db = createServiceClient();

  // Idempotency: Meta redelivers on any non-200 or timeout.
  const { error: logError } = await db
    .from("ingest_log")
    .insert({ wa_message_id: msg.id, status: "received" });
  if (logError) {
    // Unique violation means we've already seen this message id — skip.
    if (logError.code === "23505") return;
    throw logError;
  }

  try {
    const user = await getOrCreateUser(db, msg.from);
    const boards = await getBoards(db, user.id);

    const routed = await route(msg.text.body, boards);

    if (routed.intent === "command" && routed.command) {
      await runCommand(routed.command, user, msg);
    } else if (routed.intent === "query") {
      await handleQuery(db, user, msg);
    } else {
      await handleCapture(db, user, boards, msg, routed);
    }

    await db
      .from("ingest_log")
      .update({ status: "processed" })
      .eq("wa_message_id", msg.id);
  } catch (err) {
    await db.from("dead_letter").insert({
      wa_message_id: msg.id,
      raw_payload: msg,
      error_detail: err instanceof Error ? err.message : String(err),
    });
    await db
      .from("ingest_log")
      .update({ status: "error", error_detail: err instanceof Error ? err.message : String(err) })
      .eq("wa_message_id", msg.id);

    // Fallback: still save the raw text to a default board rather than lose
    // it outright. A capture in the wrong place is recoverable; a vanished
    // one is not. Skip this if the failure was in getOrCreateUser itself.
    await bestEffortFallbackCapture(db, msg).catch(() => void 0);

    throw err;
  }
}

async function getOrCreateUser(db: ReturnType<typeof createServiceClient>, fromE164: string) {
  const { data: existing } = await db
    .from("users")
    .select("id, phone_e164")
    .eq("phone_e164", fromE164)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await db
    .from("users")
    .insert({ phone_e164: fromE164 })
    .select("id, phone_e164")
    .single();
  if (error) throw error;

  // Seed a default inbox board so capture never has nowhere to land.
  await db.from("boards").insert({
    user_id: created.id,
    name: "Inbox",
    slug: DEFAULT_BOARD_SLUG,
    kind: "generic",
  });

  return created;
}

async function getBoards(db: ReturnType<typeof createServiceClient>, userId: string) {
  const { data, error } = await db
    .from("boards")
    .select("slug, name")
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

async function handleCapture(
  db: ReturnType<typeof createServiceClient>,
  user: { id: string },
  boards: { slug: string; name: string }[],
  msg: InboundTextMessage,
  routed: Awaited<ReturnType<typeof route>>
) {
  const capture = routed.capture;
  if (!capture) return;

  const board = await getOrCreateBoard(db, user.id, capture.board, boards);
  const vectors = await embed(msg.text.body).catch(() => null); // embeddings are best-effort at capture time

  const { data: item, error } = await db
    .from("items")
    .insert({
      board_id: board.id,
      user_id: user.id,
      raw_text: msg.text.body,
      parsed: capture,
      title: capture.title,
      due_at: capture.due_at,
      amount_minor: capture.amount_minor,
      currency: capture.currency,
      wa_message_id: msg.id,
      embedding: vectors?.dense ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (routed.confidence < LOW_CONFIDENCE_THRESHOLD) {
    await sendText(
      msg.from,
      `Saved to "${board.name}" as "${capture.title}" — reply "undo" if that's wrong, or tell me the right board.`
    );
  } else {
    await markAsRead(msg.id);
  }

  void item; // referenced for clarity; no further use here
}

async function getOrCreateBoard(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  slug: string,
  existingBoards: { slug: string; name: string }[]
) {
  const match = existingBoards.find((b) => b.slug === slug);
  if (match) {
    const { data } = await db
      .from("boards")
      .select("id, name")
      .eq("user_id", userId)
      .eq("slug", slug)
      .single();
    return data!;
  }

  const { data, error } = await db
    .from("boards")
    .insert({ user_id: userId, name: slug, slug, kind: "generic" })
    .select("id, name")
    .single();
  if (error) {
    // Race: board created concurrently. Fall back to the default board.
    const { data: fallback } = await db
      .from("boards")
      .select("id, name")
      .eq("user_id", userId)
      .eq("slug", DEFAULT_BOARD_SLUG)
      .single();
    return fallback!;
  }
  return data;
}

async function handleQuery(
  db: ReturnType<typeof createServiceClient>,
  user: { id: string },
  msg: InboundTextMessage
) {
  const results = await hybridSearch(db, user.id, msg.text.body);
  const { text } = await answer(msg.text.body, results);
  await sendText(msg.from, text);
}

async function bestEffortFallbackCapture(
  db: ReturnType<typeof createServiceClient>,
  msg: InboundTextMessage
) {
  const { data: user } = await db
    .from("users")
    .select("id")
    .eq("phone_e164", msg.from)
    .maybeSingle();
  if (!user) return;

  const { data: board } = await db
    .from("boards")
    .select("id")
    .eq("user_id", user.id)
    .eq("slug", DEFAULT_BOARD_SLUG)
    .maybeSingle();
  if (!board) return;

  await db.from("items").insert({
    board_id: board.id,
    user_id: user.id,
    raw_text: msg.text.body,
    wa_message_id: msg.id,
  });
}
