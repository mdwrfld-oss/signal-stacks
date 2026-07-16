# G7 Cluster Study — Worker + D3 Frontend

Interactive network/cluster diagram of G7 clients and adjacent brands — the visual
front-end of the Signal Stacks scoring system. Design rationale lives in
[G7_Cluster_Study_Plan.md](./G7_Cluster_Study_Plan.md); this README covers running,
feeding, and deploying the build (Session 1 scope, Plan §11).

## Architecture (Plan §8)

```
Google Sheet (private, Service Account)          Seed JSON (bundled fallback)
        │  Cron (daily 07:30 UTC) or POST /run          │
        ▼                                               │
   cluster-study-worker ──► KV (graph:data) ──► GET /data ◄─┘
        │                                          │
        │  POST /api/rfp/run (Claude + web search) │
        ▼                                          ▼
   KV (rfp:pending:*) ─► /review.html ─► KV (graph:overlay, merged into /data)
                                                   │
                                        public/ D3 frontend (index.html)
```

- **`/data`** serves the graph from KV; until the Sheet is populated it falls back
  to the bundled `G7_Cluster_Study_Seed_Data.json` (floor-state bootstrap, Plan §11).
  Approved RFP-lookalike nodes (the overlay) are merged in either way.
- **Frontend** (`public/`): stellar-cartography theme (§5c — dark canvas, glowing
  client/parent nodes, luminous trade-route edges, ambient idle drift), six §4f
  vertical sectors (Food & Beverage, Automotive & Transportation, Technology &
  B2B, CPGs, Sports, Hospitality/Travel/Tourism) as faint grid regions each
  pulling its member nodes' settle positions — cross-sector edges render as long
  "trade routes";
  anchored force layout with lens dimming (§4) plus §4g signals-only and
  competitor-dim toggles (all filters compose multiplicatively; competitor-dim
  hides adjacent labels outright), §5d label hierarchy (adjacent labels
  permanently subordinate to the G7 roster). **Positions are fixed** (Plan
  §II.5) — computed entirely from each entity's weighted vertical scores
  (§II.1/§II.2), no dragging; pan/zoom + reset (§4a) is the only camera
  interaction. Corporate families render as concentric rings, one per child
  at its true distance from the shared centroid (§II.4), hop-capped signal
  propagation (§6a.3), selection-triggered structural-analog highlight
  (§6a.7), click-through detail panel, search.
- **Scoring math** is shared: `public/scoring.js` is imported by the Worker bundle
  *and* the browser, so relevance/propagation are computed identically everywhere.

## Local development

Requires Node 22+ (`nvm use 22`).

```sh
npm install
npm run dev          # wrangler dev → http://localhost:8787
npm test             # vitest (graph transform, decay, propagation, routes)
```

Open `http://localhost:8787/?demo=1` to inject synthetic signals client-side
(rings, fill gradient, MABI-family propagation, new-addition ring) — useful for
tuning the visual grammar before real Signal Stacks data exists. Demo data never
touches the server.

## The Cluster Sheet (Plan §7)

A dedicated private Google Sheet — **not** published to web (it carries
COI-sensitive competitor flags). NBD maintains it directly; the header row is
locked by convention, plus an in-Sheet Notes/Instructions tab.

**Nodes tab** (tab name `Nodes`, case-insensitive headers):

| Column | Values | Notes |
|---|---|---|
| `id` | slug, e.g. `white_claw` | optional — derived from name if blank |
| `name` | display name | required |
| `type` | `hub` \| `adjacent` \| `parent` | defaults to `adjacent` |
| `category` | free text | |
| `zone` | `experiential` \| `talent` \| `combo` | hubs only; drives lens visibility, not position |
| `parent` | id of corporate parent | implies a `parent_of` link |
| `sector` | `food_beverage` \| `automotive` \| `tech_b2b` \| `cpg` \| `sports` \| `hospitality` | §4f vertical; blank = inferred (explicit hub map, then inheritance from connected hubs) |
| `is_g7_client` | TRUE/FALSE | §5a: TRUE renders always-purple (relevance brightens the shade); FALSE/blank stays floor-gray until a live signal |
| `coi_sensitive` | TRUE/FALSE | data-layer flag, surfaces in click-through only (§9 #14) |
| `notes` | free text | shows in the detail panel |
| `signal_strength` | 0–1 | with `signal_date` → ring + fill |
| `signal_date` | YYYY-MM-DD | recency decay input |
| `signal_type` | `signal_stacks` \| `rfp` | picks the ring color |
| `date_added` | YYYY-MM-DD | red new-addition ring for 7 days |
| `confidence` | free text (`verified`, `established`, …) | |

**Relationships tab** (tab name `Relationships`):

| Column | Values |
|---|---|
| `source` / `target` | node ids |
| `relationship` | `direct_competitor` \| `analogous_audience` \| `parent_of` \| `structural_analog` |
| `note` | free text |
| `coi_sensitive` | TRUE/FALSE |

Propagation strength is **computed**, never stored per row: a direct signal is
×1.0; parent/siblings ×0.5; two hops out ×0.25; capped there (§6a.3).

Share the Sheet with the Signal Stacks Service Account email (read access).

## Secrets

```sh
npx wrangler secret put SHEETS_CLIENT_EMAIL   # Signal Stacks Service Account (reused)
npx wrangler secret put SHEETS_PRIVATE_KEY    # SA private key (PEM; \n escapes OK)
npx wrangler secret put CLUSTER_SHEET_ID      # the Cluster Sheet's spreadsheet id
npx wrangler secret put ANTHROPIC_API_KEY     # RFP lookalike pipeline
npx wrangler secret put TRIGGER_SECRET        # bearer token for /run + /api/rfp/*
```

`GET /health` reports which secrets are present without exposing them.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | — | D3 frontend |
| `GET /data` | — | graph JSON (KV → seed fallback, + approved overlay) |
| `GET /health` | — | status + secret presence |
| `POST /run` | Bearer | manual Sheet ingest (Cron does this daily) |
| `GET /review.html` | — (actions need Bearer) | RFP lookalike review UI |
| `POST /api/rfp/run` | Bearer | run extraction + web-search lookalike pipeline on pasted RFP text |
| `GET /api/rfp/pending` | Bearer | pending candidate batches |
| `POST /api/rfp/review` | Bearer | approve/reject candidates → overlay nodes on the map |

The RFP pipeline (Plan §6) runs `claude-opus-4-8` with the server-side web-search
tool, extracts a profile, hunts direct competitors + analogous-audience brands
(with the Power Rangers/Pokémon few-shot anchor from §6.2), and resolves
licensor/agency as *best guess, verify before outreach*. Nothing reaches the map
without human approval (§6.1 step 6). Subaru's lost Talent-lane RFP (§11) is the
first real test case.

## One-time CSV ingestion (demo bootstrap)

`scripts/ingest-csv.mjs` matches a Backbone Sheet CSV export against the node
set: exact-normalized matches activate signals; near-misses are flagged for
review, never guessed; `--create-unmatched` turns brand-new opportunity brands
into unlinked signal nodes with a §4f sector inferred from the Vertical column.

```sh
node scripts/ingest-csv.mjs Signals1.csv --create-unmatched --out /tmp/graph.json
npx wrangler kv key put graph:data --path /tmp/graph.json \
  --namespace-id 366abe6c402243878e7b1d3b03d4a446 --remote
```

Note: the next Sheet cron ingestion (once secrets exist) will overwrite this
KV entry — the CSV pass is a demo bootstrap, not the live pipeline.

## Standalone export (offline demo file)

```sh
node scripts/export-standalone.mjs        # → export/index.html
```

Bundles the frontend into ONE self-contained HTML file that opens directly
from disk (double-click; `file://` works) — D3, styles, all JS, and the graph
JSON inlined (pulled from the live `/data` when reachable, else the bundled
seed). No dev server, no network, no Worker. View-only: the RFP pipeline and
Sheet ingestion stay in the Worker.
Re-run the script whenever the data or frontend changes; the export is a
snapshot, not a live view.

## Deploy

```sh
npx wrangler deploy
```

KV namespace `CLUSTER_KV` (`366abe6c402243878e7b1d3b03d4a446`) is bound in
`wrangler.jsonc`. Cron ingestion is a no-op (logged) until the Sheet secrets exist.

## Tuning knobs / deliberately open

- `half_life_days` (42) in `public/scoring.js` — decay half-life, to be tuned
  against real data (open question #12).
- `ANCHOR_STRENGTH` (0.22) in `public/app.js` — pull toward each entity's
  fixed, score-computed position (§II.5 — positions are not draggable).
- Ring for inherited (proximity) signals — open question #13; currently rings are
  reserved for direct signals, propagation shows as fill only.
- Talent click-through history (§10.4) — placeholder in the panel, gated on the
  Backbone Sheet `talent_name` field (Flag 5).
- Leadership portfolio view — explicitly out of scope until revenue data exists
  (Phase 3, Gate 5).
