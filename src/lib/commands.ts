import { createServiceClient } from "@/lib/supabase/server";
import { sendText } from "@/lib/whatsapp";
import type { InboundTextMessage } from "@/lib/whatsapp";

const MAGIC_LINK_TTL_MINUTES = 15;

/**
 * Fixed command handlers — no LLM call needed beyond the router recognising
 * these as commands. Each is one outbound message, which is the cost model
 * this whole app is designed around (see plan §Outbound replies become a
 * cost centre).
 */
export async function runCommand(
  command: string,
  user: { id: string },
  msg: InboundTextMessage
): Promise<void> {
  switch (command) {
    case "login":
      return handleLogin(user, msg);
    case "undo":
      return handleUndo(user, msg);
    case "delete_my_data":
      return handleDeleteMyData(user, msg);
    case "boards":
      return handleListBoards(user, msg);
    default:
      await sendText(msg.from, `Didn't recognise "${command}" as a command. Try: login, undo, boards, delete my data.`);
  }
}

async function handleLogin(user: { id: string }, msg: InboundTextMessage) {
  const db = createServiceClient();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60_000).toISOString();

  const { data, error } = await db
    .from("magic_link_tokens")
    .insert({ user_id: user.id, expires_at: expiresAt })
    .select("token")
    .single();
  if (error) throw error;

  const baseUrl = process.env.MAGIC_LINK_BASE_URL || "http://localhost:3000";
  await sendText(
    msg.from,
    `Here's your link (expires in ${MAGIC_LINK_TTL_MINUTES} min): ${baseUrl}/auth/verify?token=${data.token}`
  );
}

async function handleUndo(user: { id: string }, msg: InboundTextMessage) {
  const db = createServiceClient();
  const { data: last } = await db
    .from("items")
    .select("id, title")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!last) {
    await sendText(msg.from, "Nothing to undo.");
    return;
  }

  await db.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", last.id);
  await sendText(msg.from, `Undone: "${last.title ?? "last item"}".`);
}

async function handleDeleteMyData(user: { id: string }, msg: InboundTextMessage) {
  const db = createServiceClient();
  // Cascades: boards -> items via FK on delete cascade (see migration 0001).
  await db.from("users").delete().eq("id", user.id);
  await sendText(
    msg.from,
    "Your data has been deleted. This includes every board and item. You can start again anytime by messaging this number."
  );
}

async function handleListBoards(user: { id: string }, msg: InboundTextMessage) {
  const db = createServiceClient();
  const { data: boards } = await db
    .from("boards")
    .select("name")
    .eq("user_id", user.id)
    .order("position");

  const list = (boards ?? []).map((b) => `• ${b.name}`).join("\n") || "No boards yet.";
  await sendText(msg.from, `Your boards:\n${list}`);
}
