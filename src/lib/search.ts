import { createServiceClient } from "@/lib/supabase/server";
import { embed } from "@/lib/llm";

export interface SearchResultItem {
  id: string;
  title: string | null;
  raw_text: string;
  created_at: string;
}

/**
 * Hybrid retrieval for the QUERY intent: BGE-M3 dense (meaning, cross-lingual)
 * merged with BGE-M3 sparse (exact keyword) via reciprocal rank fusion.
 *
 * BGE-M3 replaces what would otherwise be two separate systems (pgvector +
 * a tsvector full-text pipeline) — see plan §Search: one model does the
 * whole hybrid. tsvector's English config performs poorly on Hindi written
 * in Latin script, which is most of how Hinglish gets typed.
 *
 * Aggregate questions ("what did I spend on food last month") should NOT
 * come through here — route those to aggregateQuery() below instead, so
 * arithmetic comes from SQL rather than an LLM summing retrieved snippets.
 */
export async function hybridSearch(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  queryText: string,
  limit = 8
): Promise<SearchResultItem[]> {
  const vectors = await embed(queryText);

  // Dense side: cosine similarity via pgvector HNSW index.
  const { data: denseResults, error: denseError } = await db.rpc("match_items_dense", {
    query_embedding: vectors.dense,
    match_user_id: userId,
    match_count: limit * 2,
  });
  if (denseError) throw denseError;

  // Sparse side: lexical overlap. Real implementation depends on how sparse
  // vectors end up stored (sparsevec dot product, or a separate inverted
  // index) — see the match_items_sparse() SQL function stub in
  // supabase/migrations/0002_search_functions.sql.
  const { data: sparseResults, error: sparseError } = await db.rpc("match_items_sparse", {
    query_sparse: vectors.sparse,
    match_user_id: userId,
    match_count: limit * 2,
  });
  if (sparseError) throw sparseError;

  return reciprocalRankFusion(denseResults ?? [], sparseResults ?? [], limit);
}

function reciprocalRankFusion(
  denseRanked: SearchResultItem[],
  sparseRanked: SearchResultItem[],
  limit: number,
  k = 60
): SearchResultItem[] {
  const scores = new Map<string, { item: SearchResultItem; score: number }>();

  denseRanked.forEach((item, rank) => {
    const entry = scores.get(item.id) ?? { item, score: 0 };
    entry.score += 1 / (k + rank + 1);
    scores.set(item.id, entry);
  });

  sparseRanked.forEach((item, rank) => {
    const entry = scores.get(item.id) ?? { item, score: 0 };
    entry.score += 1 / (k + rank + 1);
    scores.set(item.id, entry);
  });

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.item);
}

export type AggregateKind = "sum" | "count";

/**
 * Parameterised SQL aggregate for questions like "what did I spend on food
 * last month". Never route this through an LLM summing retrieved snippets —
 * that's how confidently wrong totals happen. This is a stub: real usage
 * needs the router to also extract { boardSlug, dateFrom, dateTo } from the
 * query, which is not yet wired into src/lib/llm.ts's route() output.
 */
export async function aggregateQuery(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  params: { boardSlug: string; dateFrom: string; dateTo: string; kind: AggregateKind }
): Promise<number> {
  const { data: board } = await db
    .from("boards")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", params.boardSlug)
    .maybeSingle();
  if (!board) return 0;

  const column = params.kind === "sum" ? "amount_minor" : "id";
  const aggFn = params.kind === "sum" ? "sum" : "count";
  const selectExpr: string = `${aggFn}(${column})`;

  const { data, error } = await db
    .from("items")
    .select(selectExpr)
    .eq("board_id", board.id)
    .gte("created_at", params.dateFrom)
    .lt("created_at", params.dateTo)
    .is("deleted_at", null);
  if (error) throw error;

  const row = (data?.[0] ?? {}) as unknown as Record<string, unknown>;
  return Number(row[aggFn] ?? 0);
}
