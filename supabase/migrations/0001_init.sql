-- WhatsApp Boards — initial schema
-- See /Users/eshan/.claude/plans/glistening-stirring-torvalds.md for the design
-- this implements.

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ─────────────────────────────────────────────────────────────────────────
-- users
--
-- wa_number_id records which WhatsApp business number a user arrived
-- through. Today every row has the same value, because there is one
-- pilot number. It is here so that the future bring-your-own-number
-- platform is a migration, not a rewrite.
-- ─────────────────────────────────────────────────────────────────────────
create table users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  display_name text,
  wa_number_id text not null default 'pilot',
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- boards
--
-- kind is intentionally a free-text column, not an enum. The plan's
-- assignment step (label 100 real messages) determines the real taxonomy;
-- do not lock it in with a type constraint before that data exists.
-- ─────────────────────────────────────────────────────────────────────────
create table boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  slug text not null,
  kind text not null default 'generic',
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

-- ─────────────────────────────────────────────────────────────────────────
-- items
--
-- embedding / sparse_embedding: BGE-M3 dense (1024-dim) and sparse vectors.
-- BGE-M3 replaces a separate full-text pipeline — see plan §Search.
--
-- wa_message_id has a unique index for idempotency: Meta redelivers
-- webhooks on any non-200 or timeout, and this is the guard against
-- duplicate captures from the same inbound message.
-- ─────────────────────────────────────────────────────────────────────────
create table items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  raw_text text not null,
  parsed jsonb not null default '{}'::jsonb,
  title text,
  due_at timestamptz,
  amount_minor bigint,
  currency text,
  source text not null default 'whatsapp', -- whatsapp | share | web
  wa_message_id text unique,
  embedding vector(1024),
  sparse_embedding sparsevec(250002), -- BGE-M3 sparse dim (vocab size)
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index items_user_id_idx on items (user_id);
create index items_board_id_idx on items (board_id);
create index items_embedding_idx on items
  using hnsw (embedding vector_cosine_ops);
create index items_created_at_idx on items (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- ingest_log — idempotency + observability for inbound webhook deliveries
-- ─────────────────────────────────────────────────────────────────────────
create table ingest_log (
  wa_message_id text primary key,
  received_at timestamptz not null default now(),
  status text not null default 'received', -- received | processed | error
  error_detail text
);

-- ─────────────────────────────────────────────────────────────────────────
-- dead_letter — raw payloads that failed to process for any reason.
-- Nothing a user typed should ever be silently lost; this is the backstop.
-- ─────────────────────────────────────────────────────────────────────────
create table dead_letter (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text,
  raw_payload jsonb not null,
  error_detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────
-- magic_link_tokens — WhatsApp-DM-based auth, single-use, short expiry.
-- No SMS OTP: it costs money per send and we already have an open channel.
-- ─────────────────────────────────────────────────────────────────────────
create table magic_link_tokens (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- All tables scoped to auth.uid(). The web app authenticates via Supabase
-- auth (session established from the magic-link flow); auth.uid() maps to
-- users.id via a matching row created at auth time.
-- ─────────────────────────────────────────────────────────────────────────
alter table users enable row level security;
alter table boards enable row level security;
alter table items enable row level security;
alter table magic_link_tokens enable row level security;

create policy users_select_own on users
  for select using (id = auth.uid());

create policy boards_all_own on boards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy items_all_own on items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ingest_log, dead_letter, magic_link_tokens: no user-facing policies.
-- Written only by the service role from webhook / server routes, which
-- bypasses RLS by design. Never expose the service-role key to the client.
