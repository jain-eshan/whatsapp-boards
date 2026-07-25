-- Search RPC functions backing src/lib/search.ts's hybridSearch().
--
-- match_items_dense is real: standard pgvector cosine similarity, ready to
-- use once items.embedding is populated by embed().
--
-- match_items_sparse is a STUB. BGE-M3's sparse output is a token-id -> weight
-- map (lexical weights over the tokenizer vocabulary), and there isn't yet a
-- settled approach here for storing/querying it in Postgres — options are
-- pgvector's sparsevec with a dot-product operator, or an inverted index
-- (token_id -> item_id posting list) if sparsevec proves awkward at query
-- time. Pick one after the search step is actually being built (plan
-- §Saturday evening — talk-back) rather than guessing now.

create or replace function match_items_dense(
  query_embedding vector(1024),
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
    and i.embedding is not null
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- STUB — returns nothing until sparse storage/query strategy is chosen.
-- Keeping the signature stable so src/lib/search.ts doesn't need to change
-- shape when this is filled in, only the query body.
create or replace function match_items_sparse(
  query_sparse jsonb,
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
  where false -- TODO: implement sparse matching, see comment above
  limit match_count;
$$;
