# Boards

A WhatsApp number you capture to, and a web app where it actually lives.

## Why the obvious version doesn't exist

The obvious version of this product is: a bot that lives inside your WhatsApp
groups, creates new groups on your behalf, and turns each one into a searchable
board. That version is not buildable by a solo developer in 2026, and it's
worth explaining exactly why, because the reasoning is more useful than the
code.

**There is no client-side plugin surface in WhatsApp, and there never has
been.** No third-party code runs inside the app. This isn't a gap to route
around — it's the platform.

**You cannot add a bot to an existing WhatsApp group.** The closest sanctioned
mechanism is Meta's Groups API, which lets an Official Business Account
*create* groups (capped at 8 participants, one business per group, invite-link
join only, no interactive buttons). That's a real capability, and it maps well
onto personal boards — a bot-created group with one participant is a workable
shape for a board that "talks back."

It's gated behind something that rules out a weekend project, though. As of
July 2026, using the Groups API requires an **Official Business Account**,
which requires:

- 30 days minimum registered on the WhatsApp Business Platform before you can
  even apply
- Submission **only through a Business Solution Provider** — Meta removed
  self-service applications
- Approval based on **brand notability backed by reputable media coverage**

That last requirement is the actual wall. It's a subjective review, not a
checklist, and it exists specifically to keep individual developers from
spinning up groups programmatically. So: Groups are the right long-term answer
and are indefinitely out of reach for this project. This is a finding, not a
TODO.

**Unofficial libraries (Baileys, whatsapp-web.js) were ruled out on purpose.**
They violate WhatsApp's Terms of Service, carry real account-ban risk with no
appeal path, and the ecosystem around them has had credential-exfiltration
malware published to npm. Not something to ship to strangers, or to run
yourself.

## What this actually is

Given those constraints, the shape that's left: capture happens over WhatsApp
DM (official Cloud API), because that's where the thought occurs. Reading,
searching, and organizing happen in a web app, because WhatsApp cannot search
or filter and never will. A PWA share target is the second entry point, for
forwarding a link or a message without typing.

```
                              ┌──> CAPTURE ──> boards (Supabase)
WhatsApp DM ──┐               │
              ├──> router ────┼──> QUERY ────> hybrid search ──> answer
PWA share ────┘               │
                              └──> COMMAND ──> login / undo / delete my data
```

Three intents, not one: **capture** (the default — a to-do, a note, an
expense, a link, acknowledged with a silent read receipt), **query** (a
question about past captures, answered in words), and **command** (`login`,
`undo`, `delete my data`, `boards` — fixed handlers).

## The pricing constraint that shaped the design

From **1 October 2026**, Meta starts charging for every free-form reply sent
inside the 24-hour service window — the same per-country rate as utility
templates. Before that date these replies have been free. Inbound messages
stay free either way.

That changes what "the reply" means. A tool that says "✅ Saved: buy milk"
after every message is a tool whose running cost scales linearly with how much
people use it. So capture is acknowledged with a **read receipt** — a status
call to the messages endpoint, not an outbound send — and words are reserved
for query answers, low-confidence corrections, and commands.

**This rests on one unverified assumption**: that marking a message as read
isn't billed as an outbound message. It's a strong inference (it's a status
call, not a send, and Meta's pricing docs don't list it as billable), not a
confirmed fact. If it turns out to be billed, the ack strategy flips to a
once-daily digest via a single env flag (`ACK_MODE`) — see `src/lib/whatsapp.ts`.

At pilot scale (10–20 people), none of this is actually expensive. The cost
table exists so the economics stay honest if this ever grows past a closed
pilot:

| Users | Est. monthly cost (India rates, post–1 Oct) |
|---|---|
| 20 | ~₹560 (queries only, if ack is free) |
| 1,000 | ~₹28,000 (captures start being billed too, if the ack assumption is wrong) |
| 10,000 | ~₹2.8 lakh |

Meta hasn't published the October rate card as of this writing; the table
above is proxied off today's utility-message rates.

## Model choices

Router/extraction, query answering, and embeddings are three different jobs
with different requirements, so they use different models rather than one
model doing everything:

| Job | Model | Why |
|---|---|---|
| Router + field extraction (every message) | Qwen3.6-35B-A3B | MoE, ~3B active params — fast and cheap on the hot path. Strong open-weight multilingual, which Hinglish needs. Extraction, not reasoning. |
| Query answering (low volume) | Kimi K2.5 | Strong on multilingual long-context retrieval. Low volume means cost doesn't matter here; accuracy does. |
| Embeddings | BGE-M3 | Dense + sparse from one pass, 100+ languages. Replaces a separate full-text search pipeline outright — Postgres's `tsvector` with the English config does poorly on Hindi written in Latin script, which is most of how this gets typed. |

All routed through OpenRouter, model IDs in env vars, behind one interface
(`src/lib/llm.ts`). Swapping models is a config change. **Don't take the table
above on faith** — the repo includes the eval harness this was decided with:
label 100 real messages from your own WhatsApp history, run each candidate
against them, and measure routing accuracy, field accuracy, and p95 latency.
Open weights were chosen for self-hostability and data residency, not because
they're meaningfully cheaper at pilot scale — at 20 users the price gap
between an open MoE and a frontier model is a few dollars a month.

## Privacy

This server sits between you and your data. That needs a stated posture, not
a hand-wave:

- **Retention:** items are kept until deleted. `delete my data`, sent as a
  WhatsApp message, deletes the user row and cascades to every board and item.
- **Encryption at rest:** Supabase-managed Postgres encryption at rest.
- **No training on user content.** Message text is sent to third-party model
  providers (OpenRouter-routed) for routing and answering — not stored by
  them beyond the request, per their stated policies at time of writing.
  Verify current terms before trusting this at scale.
- **Data fiduciary:** [fill in — the person/entity operating the pilot
  instance].
- **DPDP Act (India):** applies because real users are the goal. This section
  needs a real legal read before the pilot has users outside the builder's
  immediate circle, not just an engineering good-faith gesture.

## What's deliberately not here yet

- **Groups API.** See above — blocked, not deferred.
- **BYO-number / multi-tenant platform.** The data model has one
  future-proofing concession (`users.wa_number_id`) and nothing else. Build
  the rest only once a pilot proves people want this.
- **Payment layer.** Same reasoning.
- **Voice-note transcription.** Cut from the first build to ship the text
  path first; it's the one piece with a per-use cost beyond messaging.

## iOS

Android Chrome installs this as a PWA and gets the native share sheet
(`share_target` in `src/app/manifest.ts`). **iOS PWAs cannot register as share
targets** — this is a platform limit, not a bug here. iPhone users get an iOS
Shortcut instead (not yet built — add one that POSTs to `/api/share`).

## Running this yourself

See `.env.example` for the full list of required secrets: a Meta app +
WhatsApp Cloud API number, a Supabase project, and an OpenRouter key.

```bash
npm install
cp .env.example .env.local   # fill in secrets
npx supabase db push          # applies supabase/migrations/
npm run dev
```

Point the Meta app's webhook at `/api/whatsapp/webhook`. The free developer
test number caps at 5 recipients — a real pilot needs a paid number with a
phone that has never been registered on WhatsApp before, plus display-name
review. Start that process before you need it; it takes days.

## Status

This is a stub build, not a finished product. Concretely unfinished:

- `src/lib/llm.ts`'s `embed()` needs a real BGE-M3 endpoint (self-hosted, or a
  provider serving `BAAI/bge-m3`).
- `src/lib/search.ts`'s sparse-vector matching (`match_items_sparse` in
  `supabase/migrations/0002_search_functions.sql`) is unimplemented — the
  storage/query approach (pgvector `sparsevec` vs. an inverted index) needs to
  be picked once this is actually being built against real data.
- Auth is a plain cookie naming a user id (`src/app/auth/verify/page.tsx`), not
  a real Supabase session — fine for a closed pilot, not fine once RLS needs
  to actually hold.
- `/api/share`'s route contract is defined but doesn't persist yet.
- Placeholder PWA icons (`public/icons/`) — swap before a real launch.

See `/Users/eshan/.claude/plans/glistening-stirring-torvalds.md` for the full
design doc this implements.
