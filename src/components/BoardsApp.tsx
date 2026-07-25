"use client";

import { useMemo, useState, useTransition } from "react";
import type { Board, Item } from "@/types/board";

interface BoardsAppProps {
  userId: string;
  initialBoards: Board[];
}

/**
 * Client shell for the boards view: sidebar of boards, item list for the
 * selected board, search-as-you-type across everything. This is the surface
 * that replaces the multiple-WhatsApp-groups hack — see plan §Architecture.
 *
 * Data fetching goes through /api/boards/* route handlers (not written yet
 * — this component defines the shape those routes need to satisfy) rather
 * than the Supabase browser client directly, because the client would need
 * a real RLS-compatible session (see auth stub note in
 * src/app/auth/verify/page.tsx) which isn't wired up yet.
 */
export default function BoardsApp({ userId, initialBoards }: BoardsAppProps) {
  const [boards] = useState<Board[]>(initialBoards);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(
    initialBoards[0]?.id ?? null
  );
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectedBoard = useMemo(
    () => boards.find((b) => b.id === selectedBoardId) ?? null,
    [boards, selectedBoardId]
  );

  function selectBoard(boardId: string) {
    setSelectedBoardId(boardId);
    startTransition(async () => {
      const res = await fetch(`/api/boards/${boardId}/items`);
      if (res.ok) setItems(await res.json());
    });
  }

  function runSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      if (selectedBoardId) selectBoard(selectedBoardId);
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setItems(await res.json());
    });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border p-4">
        <h1 className="mb-4 text-sm font-semibold tracking-tight">Boards</h1>
        {boards.length === 0 ? (
          <p className="text-sm text-muted">No boards yet. Capture something on WhatsApp first.</p>
        ) : (
          <nav className="flex flex-col gap-1">
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => selectBoard(board.id)}
                className={`rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  board.id === selectedBoardId
                    ? "bg-surface font-medium"
                    : "text-muted hover:bg-surface"
                }`}
              >
                {board.name}
              </button>
            ))}
          </nav>
        )}
      </aside>

      <main className="flex-1 p-6">
        <input
          type="search"
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          placeholder="Search everything…"
          className="mb-6 w-full max-w-md rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />

        {isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState boardName={query ? null : selectedBoard?.name ?? null} query={query} />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </main>

      <p className="sr-only">User: {userId}</p>
    </div>
  );
}

function EmptyState({ boardName, query }: { boardName: string | null; query: string }) {
  if (query) {
    return (
      <p className="text-sm text-muted">
        Nothing found for &ldquo;{query}&rdquo;. Try asking the bot on WhatsApp instead — it can
        answer in words, not just find exact matches.
      </p>
    );
  }
  if (!boardName) {
    return <p className="text-sm text-muted">Pick a board on the left.</p>;
  }
  return (
    <p className="text-sm text-muted">
      Nothing in &ldquo;{boardName}&rdquo; yet. Message the bot on WhatsApp — it lands here.
    </p>
  );
}

function ItemRow({ item }: { item: Item }) {
  return (
    <li className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <p className="font-medium">{item.title ?? item.raw_text}</p>
      <div className="mt-1 flex gap-3 text-xs text-muted">
        {item.due_at && <span>due {new Date(item.due_at).toLocaleDateString()}</span>}
        {item.amount_minor != null && (
          <span>
            {item.currency ?? ""} {(item.amount_minor / 100).toFixed(2)}
          </span>
        )}
        <span>{new Date(item.created_at).toLocaleString()}</span>
      </div>
    </li>
  );
}
