-- Replaces the BGE-M3 sparse-vector search plan with pg_trgm, already
-- provisioned in 0001_init.sql. True BGE-M3 sparse output needs the raw
-- FlagEmbedding library, which isn't practically self-hostable at pilot
-- scale — see the embed() comment in src/lib/llm.ts. sparse_embedding was
-- never written to (persistCapture() only ever set `embedding`), so this
-- drops dead schema rather than dead code.

alter table items drop column if exists sparse_embedding;

drop function if exists match_items_sparse(jsonb, uuid, int);

create or replace function match_items_trgm(
  query_text text,
  match_user_id uuid,
  match_count int default 16
)
returns table (
  id uuid,
  title text,
  raw_text text,
  created_at timestamptz
)
language sql stable
as $$
  select i.id, i.title, i.raw_text, i.created_at
  from items i
  where i.user_id = match_user_id
    and i.deleted_at is null
    and (i.title % query_text or i.raw_text % query_text)
  order by greatest(similarity(i.title, query_text), similarity(i.raw_text, query_text)) desc
  limit match_count;
$$;

-- Mutable search_path, same class of finding 0003 fixed for the other RPCs.
alter function match_items_trgm(text, uuid, int) set search_path = public, extensions;
