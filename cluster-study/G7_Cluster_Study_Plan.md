# G7 Cluster Study — Planning Reference

*Broken out from the Signal Stacks & Cluster Study master plan. Status: concept and visual design substantially locked; still tabled behind Signal Stacks reaching functional maturity. Node-data bootstrap has started independently (Section 11). No D3 code has been built yet. References Signal Stacks where the two systems intersect, but this doc is Cluster-focused.*

---

## 1. Concept

A visual, interactive network/cluster diagram (style reference: classic epidemiological contact-network diagrams) showing G7 clients as central hub nodes, with adjacent/competitor/category-similar brands radiating outward — making brand relationships explorable visually rather than just as text/data.

## 2. Why it's more than a novelty (functional design principles)

1. **Grounded edges, not eyeballed** — line weight/connection based on the same lookalike-scoring logic Signal Stacks already computes, not hand-curated guesses
2. **Tied into the Signal Stacks pipeline** — the visual front-end of the scoring/roster system, not a separate static artifact
3. **Actionable nodes** — clicking a node should surface live signal data, not just a label
4. **Multi-client navigation** — needs to work as a browsable system across the ~11 Tier 1 clients, not a single fixed chart
5. **Living status layer** — visual state should reflect real recency/relevance, not be static
6. **Guiding principle (added this session):** Cluster's job is to surface *who else to talk to*, not to duplicate deal/status tracking the team's existing spreadsheets already do well. When a feature idea starts to look like a dashboard (won/lost tracking, current-vs-past client status, detailed pipeline state), that's a signal to scale it back to a scoring input rather than a displayed status. See Section 6 for where this played out directly.

## 3. Primary users & views

- **NBD** — exploration/brainstorming use case, explicitly chosen over live-status-tracking or pitch-tracking uses. Wants a **hub-and-spoke view per client.**
- **Leadership/SVP** — category coverage + account concentration risk. Wants a **portfolio-wide view** (treemap/bubble-style).
- **Key finding:** these are two different chart types over the same data, not one chart with filters. The Leadership view additionally requires real revenue/project-volume data per client/category that hasn't been sourced yet (see Section 7). The NBD view does not depend on this and is the more achievable first build.
- **Phasing (decided in a later planning session):** NBD's hub-and-spoke view is the full scope of the initial build. Leadership's portfolio view is explicitly deferred to a later phase (**"Phase 3"** in team-facing framing) — not designed further or built against until revenue/project-volume data exists. See Section 11, Gate 5.

## 4. Layout — anchored default positions with lens-based dimming (revised this session)

**Resolved:** nodes hold **anchored default positions** — a single force simulation determines where each node settles on load, and a gentle anchor force (`forceX`/`forceY` toward a stored `homeX`/`homeY`) continuously pulls each node back there whenever nothing else is happening. This is not the same as literally static/frozen coordinates — see 4b for the interactive drag behavior this enables — but it preserves the same practical outcome the original "fixed positions" language was going for: a user builds spatial memory of where things are, and the map doesn't reshuffle on its own or when switching lenses. No separate Experiential/Talent canvases, no re-settling animation when switching views. A lens toggle (Experiential / Talent) changes **visibility treatment only**: nodes relevant to the active lens render at full color/saturation; nodes outside it render translucent/desaturated ("switched off") rather than disappearing. Combo nodes (~20% of business, the most desired client type) render at full strength in both lenses, since they're genuinely relevant to both.

**Why this beats the alternatives considered:**
- Simpler to build than two independent simulations or filtered-visibility re-settling — no transition/crossfade logic needed
- Preserves spatial memory — the same brand returns to the same place regardless of which lens is active or how it's been dragged around, which matters for something meant to be browsed casually and repeatedly
- Cleanly resolves the multi-zone parent-entity problem (Section 6a): a parent node like Kellogg's, spanning children in different lenses, simply renders at full strength in both lenses from one default position — no forced single-zone assignment required

**Superseded:** the original single-canvas Venn-style two-zone layout (zone = position within one shared space) is replaced by this anchored-position + lens-dimming approach. Each hub node still carries a `zone` value (Experiential / Talent / Combo — see the seed dataset), but that value now drives *lens visibility behavior* rather than physical position within a shared Venn diagram.

### 4a. Pan and zoom (added this session)
D3's built-in `d3.zoom()` provides pan (click-drag) and zoom (scroll/pinch) over the canvas — a standard pattern for dense network diagrams, and it operates independently of node position (camera-view change, not a layout change). Two things worth carrying into the build:
- **A reset-to-default-view control**, so users don't get lost after panning/zooming around.
- **Click vs. drag disambiguation** — D3's zoom behavior can eat click events if not configured carefully, and nodes need to stay clickable (talent history panel, structural-analog highlight, etc.) as well as draggable (4b). Flag for whoever builds this in Claude Code; not a design-level concern.

Zoom also directly resolves the ring-density question from Section 9 — see the note there.

### 4b. Draggable nodes with return-to-home (added this session)
Inspired directly by Obsidian's graph view. Nodes can be grabbed and dragged to temporarily rearrange the map — neighboring nodes respond naturally via the existing link/charge/collision forces during the drag, same visual language as Obsidian — and on release, the anchor force (4, above) eases the node back to its default position rather than leaving it wherever it was dropped. This gives users a way to manually declutter or explore a dense area (e.g., pulling the Mark Anthony Brands hull apart to see it more clearly) without permanently disrupting the layout others rely on for spatial memory.
- **Estimated add: 4–7 hours** on top of core mechanics — anchor-force setup/tuning, drag handlers, making hull boundaries (6a.1) and connector lines recompute live during a drag rather than only rendering once, and general smoothness tuning.
- **Not yet decided:** whether a subtle idle drift (very low-amplitude motion around the home position, distinct from drag) is worth adding for the "alive" feel Obsidian has at rest, or whether the anchor force should hold nodes fully still until actively dragged. Low-cost either way; worth deciding once the core drag mechanic is working and can be felt rather than imagined.

## 5. Visual grammar — resolved to a two-state color model (revised this session)

Originally proposed as three-plus color states (recency-fading gray for "aware but thin," green for client status with its own fade, plus the floor state). After working through the philosophical question of what Cluster is *for* (Section 2, principle 6), this collapsed back to two states:

| Channel | Encodes | Values |
|---|---|---|
| **Ring** | Whether an active, real signal exists (binary/categorical) | Present / absent |
| **Fill darkness** | Relevance — a blend of signal strength × recency decay | Continuous purple gradient (G7 brand color), dark = high relevance. A thin signal (e.g., a bare news mention with no real connective intel) is simply a **low signal_strength** input into this same gradient — it does not need its own hue or its own fade mechanism. |
| **Floor color** | No signal has ever existed for this node — pure environmental/research context | A distinct, **static** hue (not part of the purple gradient, does not fade) — resolves former open question #10. Candidate: neutral gray. |

**Why client status (current/past) and RFP outcome (won/lost) don't get their own colors:** both were considered and explicitly descoped. Client status is exactly the kind of detail the team's existing spreadsheets already track well — adding it to Cluster as a maintained field turns the tool into a dashboard duplicate rather than a discovery tool. RFP outcomes are handled differently: see Section 6.

**Relevance formula:**
```
relevance = signal_strength × recency_decay(days_since_signal)
```
Exponential falloff (e.g., halving every N weeks) rather than a hard cutoff — nothing is hidden, just de-emphasized. Half-life parameter still needs tuning against real data (open question, Section 9).

**Value of the floor state:** floor-state nodes (Namco-style pure theoretical analogs, no live signal) are what make a broader "show all plausible brands in the space" view viable — useful for cold outreach or general environmental/category context — without every node needing to justify its presence with a real signal.

## 6. RFP tracker as a scoring input (revised this session — no longer a displayed status type)

**Original framing (superseded):** RFP outcomes (`Won`/`Lost`/`Pursued`) as a visible node/status type in Cluster, similar to a pipeline tracker.

**Revised framing:** an RFP — won or lost — is a **high-strength scoring event** that feeds the existing relevance formula (Section 5) and, more importantly, **triggers the lookalike search pipeline** below. It does not need its own color, badge, or persistent status display. The insight value of "we deeply researched this niche" is captured by surfacing *parallel brands*, not by Cluster maintaining a mirror of the business tracker's won/lost field. A lost Alienware pitch shows up as a well-saturated, ringed node (real signal, real relationship) that decays like any other signal if nothing follows up — the click-through detail is where "why is this still worth a look" gets explained, not a permanent status badge.

### 6.1 Proposed pipeline

| Step | What happens | Tooling |
|---|---|---|
| 1. Input capture | RFP brief + response deck, sourced from the existing business tracker (already logs won/lost/pursued status) | Manual entry or file parsing |
| 2. Extraction | Pull structured profile: target audience, IP category, licensor, demo/psychographic notes | Claude API, deck-appropriate extraction (likely needs more than the lightweight extraction used for RSS in Signal Stacks) |
| 3. Lookalike search | Given the extracted profile, search for adjacent brands — both direct competitors and analogous-audience entities | Claude API + web search tool |
| 4. Licensor/agency resolution | Identify who holds the licensing/marketing relationship for each candidate (e.g., BVS for Power Rangers) | Web search, treated as "best guess, verify before outreach" — licensing relationships change hands and go stale |
| 5. Structured output | Ranked candidate list: brand, relationship type (competitor vs. analogous), licensor/agency, confidence, one-line rationale | JSON schema with defensive parsing, same discipline as Signal Stacks scoring output |
| 6. Human review + import | User approves/rejects candidates before they become live Cluster nodes | Simple approval step, TBD interface |

### 6.2 Known risk
The competitor-vs-analogous distinction (Power Rangers = direct competitor to Ultraman, tokusatsu; Pokémon = analogous audience, different medium) is a judgment call, not a lookup. Expect to need a few worked examples as few-shot anchors in the prompt rather than a zero-shot ask. Licensor/agency fields should be timestamped as "last verified" given how often those relationships change.

## 6a. Corporate structure & connection distance (added this session)

Prompted by a real case: Pringles (a real G7 relationship) is owned by Kellogg's, which also owns Cheez-It. These shouldn't render as unrelated entities — but they also shouldn't be full peers, since the direct relationship is with Pringles specifically.

**Unifying insight:** this is structurally the same problem as the sister-agency warm-path signal (Flag 1) and conceptually similar to LinkedIn's tiered-connection display — in all three cases, relevance should propagate outward from a known point through real relationship structure, at reduced confidence per hop. Worth treating this as one general **"connection distance"** mechanism rather than three separate features that happen to look similar. Parent/subsidiary corporate structure and sister-agency client relationships are two concrete instances of the same underlying pattern.

### 6a.1 Visual treatment
Parent entities are **full nodes** (not just labels), since business at one child can plausibly lead to business at the parent or at siblings. A convex-hull-style boundary (standard D3 pattern via `d3.polygonHull()`) can visually group a parent with its children, updating automatically as the force simulation moves nodes — this is a background/grouping layer, not a new per-node channel competing with ring/fill/size.

### 6a.2 New edge type
`parent_of` / `subsidiary_of` — distinct from `direct_competitor` and `analogous_audience`, since it's a structural relationship, not a competitive or audience one.

### 6a.3 Signal propagation — three-step schema (resolved this session)
Rather than continuous decay by hop distance (harder to read), propagation uses three discrete steps:

| Step | State | Multiplier applied to the source node's current relevance score |
|---|---|---|
| 1 | Solid Signal | 1.0 (the node with the actual detected signal — e.g., Pringles in the news) |
| 2 | Proximity Signal | 0.5 (direct parent/sibling — e.g., Kellogg's, Cheez-It) |
| 3 | Proximity Signal Once Removed | 0.25 (two hops out) |

**Capped at two hops.** Beyond "once removed," propagation stops — deeper corporate trees risk lighting up large parts of the map faintly from one news event, which is worse for readability than it is valuable for signal.

### 6a.4 Zone/lens interaction
Since positions are now fixed with lens-based dimming (Section 4), a parent spanning children in different lenses doesn't need a forced single-zone assignment — it simply appears at full strength in whichever lens(es) its children belong to.

### 6a.5 Ingestion path (proactive structural updates)
Corporate ownership changes (acquisitions, spinoffs, brand sales) are exactly the kind of event that can show up in Signal Stacks' existing RSS/editorial pipeline. Proposed: add an ownership-change extraction category to the existing Haiku prompt (acquirer, acquired entity, date), alongside the artist/brand extraction it already does. **Guardrail:** ownership-structure changes should route through a human approval step before mutating Cluster's parent/child graph — an incorrect structural change is a worse failure mode than a stale relevance score, since it corrupts the graph itself rather than just one data point. Same review pattern as the RFP-lookalike approval step (Section 6.1, step 6).

### 6a.6 Data burden (same shape as Data Blocker #1)
Parent/subsidiary mapping is its own research lift on top of the competitor/analog research already underway, and ownership structures go stale the same way competitive landscapes do. Not a reason to skip it, just a maintenance cost to log.

### 6a.7 Rendering structural analogs — selection-triggered, not persistent (resolved this session)
Structurally analogous clients (Section 11's `structural_analogs` field — e.g., Mark Anthony Brands ↔ Swisher) are a fundamentally different kind of relationship from `direct_competitor`/`analogous_audience` and from `parent_of`, and need different visual treatment:

- **Not physical proximity.** Unlike parent/subsidiary hulls, structural analogs should *not* pull nodes close together in the force layout — Mark Anthony Brands and Swisher aren't neighbors in any meaningful sense, and clustering them near each other would misrepresent the relationship as something closer to competitive/audience adjacency than it is.
- **Not a persistent line either.** A permanent connecting edge between every structurally-analogous pair would clutter the graph with relationships that are only occasionally useful, unlike grounded competitor/analog edges which are core to the layout's purpose (Section 2, principle 1).
- **Resolved approach: selection-triggered highlight.** Structural-analog connections render only when a node is actively selected/clicked — at that moment, its structural analogs light up (e.g., a distinct highlight color or connecting line that appears only in this state), then disappear when the selection clears. This keeps the default view clean while still surfacing the insight ("this client is structured like that one") exactly when it's useful — during focused exploration of a specific node, not as ambient visual noise.
- **General pattern worth reusing:** this selection-triggered-only rendering is a reasonable model for any relationship type that's real and useful but not spatially meaningful — worth keeping in mind if other non-spatial relationship types emerge later.

## 7. Data dependencies (the real blocker)

1. **Per-client curated adjacent/competitor brand lists** — real research needed; general-knowledge mockups (as done for Bandai Namco) won't scale to less-obvious clients. **In progress** — see Section 11.
2. **Revenue/project-volume figures per client/category** — blocks the Leadership view entirely; not sourced yet
3. **Project Worldwide sister-agency client list** — blocks the sister-agency connection-distance layer (Section 6a); user is checking on availability of a historical account
4. **RFP tracker data mapping** — tracker already exists and logs won/lost status; still needs schema mapping into the scoring pipeline (Section 6)
5. **Parent/subsidiary corporate structure mapping** — new as of Section 6a; needed to populate `parent_of` edges

**Ingestion mechanism (decided in a later planning session):** a dedicated Google Sheet, separate from but structurally similar to Signal Stacks' backbone Sheet — a **Nodes tab** (client/brand name, corporate parent, category, Experiential/Talent/Combo lane, COI flag) and a **Relationships tab** (connected node pairs, relationship/signal type; propagation strength itself is computed algorithmically per Section 6a's hop-capped multiplier, not stored per row). NBD maintains this Sheet directly; schema fields are fixed by convention (locked header row plus an in-Sheet Notes/Instructions tab), not enforced in code. Auth reuses the existing Signal Stacks Service Account, scoped to also read this Sheet. See Section 8 for how this Sheet is consumed (Cron ingestion → KV → serving Worker) — this replaces the live-read-from-Sheet approach originally described there.

## 8. Platform recommendation

- **Superseded (see note below):** ~~D3.js, hosted free on GitHub Pages, reading live from the same Google Sheet Signal Stacks already uses.~~
- **Revised primary (decided in a later planning session):** D3.js, but hosted on **Cloudflare Workers** rather than GitHub Pages — `cluster-study/` as a sibling Worker project to `signal-stacks-worker/` in the Signal Stacks repo, following the same architecture already proven out for Signal Stacks and Scout.
- **Why this changed:** the Sheet this reads from (see Section 7 update below) carries real client relationship data, including COI-sensitive competitor flags (Section 6a/9) — it needs to stay a private, Service-Account-authenticated Sheet, not a "publish to web" public one. A pure static-HTML-fetches-Sheet-directly pattern (GitHub Pages' natural mode) can't hold that auth safely in browser-side code. Cloudflare Workers can, using the same Service Account + Web Crypto JWT pattern Signal Stacks already uses.
- **Revised architecture:** a Cron-triggered ingestion Worker pulls the Sheet on a schedule, transforms rows into graph JSON, and writes to KV. A separate serving Worker exposes a `/data` endpoint reading from KV. The frontend (D3 + HTML/JS, same visual grammar as designed throughout this doc) fetches from that endpoint rather than embedding data directly — this also satisfies the "no HTML redistribution when data updates" requirement, since NBD edits the Sheet and the next Cron run makes it live for all users automatically.
- **Alternative considered (still stands):** Streamlit (Python) — rejected primarily due to free-tier cold-start delay for an occasionally-used internal tool.
- User is unfamiliar with D3; Claude would write the code directly. Not a barrier to the recommendation.
- Ring rendering, lens-based opacity toggling, convex-hull grouping (Section 6a), and the visual grammar above are all standard D3 patterns — confirmed buildable, not theoretical, and unaffected by the hosting change above.
- **Setup note (revised):** no GitHub Pages step needed. Repo/branch structure, Cloudflare account, and Service Account access were already set up in a later session — see Section 7 update. Claude Code remains the recommended build environment — it can create files directly in the repo, run a local preview server, iterate on the force-layout tuning in a tight loop, and handle git commit/push and Cloudflare Worker deployment end to end, none of which this chat interface can do.

## 9. Open design questions

1. ~~When a new signal scores similarly to two existing clients~~ — **Resolved:** connects to both.
2. ~~Should connection strength be visible~~ — **Resolved:** connected/not-connected is enough for now; no line-thickness encoding.
3. ~~What defines "recency" across clients/prospects/RFPs~~ — **Resolved, scaled back:** for now, just identify clients — don't try to encode differentiated recency clocks per type. Differentiated recency (if needed) is a phase 2 addition, not part of the initial build.
4. ~~If a decayed node gets re-flagged later~~ — **Resolved:** snaps back to full purple immediately, no gradual ease-in.
5. On click, what's the single most useful thing a node should surface — resolved for the Talent side (Section 10.4). Still open for the Experiential/client side.
6. ~~Do people need direct search/jump-to-client~~ — **Resolved:** yes, search is wanted alongside browsing.
7. ~~Tier 1 only, or every plausible brand~~ — **Resolved:** build out hubs wherever relevant, not limited to the original Tier 1 list. (Already happening in practice — see Mike's Hard Lemonade, Cayman Jack, Olé, Mojo Energy, all added this session.)
8. ~~Is "current client" visually distinct from "past client"?~~ — **Descoped**, see Section 2 principle 6 and Section 5.
9. ~~Ring stacking~~ — **Resolved, expanded:** two distinct rings/colors for Signal Stacks detection vs. RFP-sourced opportunity, **plus a third ring style for sister-agency relationships** (Section 6a's connection-distance mechanism, once the sister-agency data unblocks per Flag 1). Three concurrent ring types is a real visual density question — see the note below on ring rendering.
10. ~~Floor color choice~~ — **Resolved, see Section 5.**
11. ~~Animation~~ — **Resolved:** new additions get a red ring that lasts one week, then reverts to standard ring styling. **Additive, not override:** the new-addition ring stacks alongside any other concurrent ring types (Signal Stacks, RFP, sister-agency) rather than replacing them for that week — seeing every modifier on an entity at a glance matters more than keeping the default view minimal. This leans more heavily on the zoom-conditional resolution (Section 9's ring rendering note) as the way to parse a node with several concurrent rings, since the default view won't simplify that case away.
12. Decay parameters: half-life for the recency decay function — still needs tuning against real data, not decided in the abstract.
13. Does the hop-capped propagation multiplier (6a.3) combine with ring stacking (#9) in any special way — e.g., does a proximity-signal node ever get its own ring, or is a ring reserved for direct (non-inherited) signals only? Still open, and now more pressing given #9's three ring types.
14. ~~COI-sensitive competitors~~ — **Resolved: no visual treatment needed.** Stays a data-layer flag; NBD's own judgment already covers engagement nuance better than a graph warning could.

**Ring rendering — resolved via zoom-conditional detail (added this session).** The density concern (up to four concurrent ring states on one node) and the ring-text-label question are both resolved by the same mechanism: pan/zoom (Section 4a) changes what a node needs to communicate at any given moment.
- **At default zoom:** rings stay simple — color/style only, just enough to signal "something's layered here" even if two rings partially overlap. At-a-glance distinctness at default zoom is still the bar, since that's what determines whether something looks worth zooming into in the first place.
- **Past a zoom threshold:** rings separate naturally from magnification alone, and small text labels become viable on the rings themselves at that point, since crowding is no longer the binding constraint.
- This means color-only vs. text-labeled rings isn't a single either/or choice — it's zoom-dependent, ambitious at close range without compromising the default browsing view. A prototype (built earlier this session with the Visualizer) confirmed the color-only default reads fine even with two ring types on one node; zoom-in detail can be validated once real code exists.

## 10. Talent-side refinements

Three refinements specific to the Talent Booking half of Cluster, evaluated for feasibility:

### 10.1 Node size = booking frequency / talent tier
A fourth independent visual channel (alongside fill/relevance and ring/signal-presence) — mechanically a standard D3 `radiusScale`, no different in kind from the color scale already planned. **Gated on data:** needs either a booking-count field or an arena/emerging tier classification per talent, which doesn't exist yet — the Talent Booking lane's schema is explicitly blocked on an NBD-provided talent-type list (see Flag 5, below). Easy to build once that data exists; not buildable before it does.

### 10.2 Auto-aggregation from the Backbone Sheet
The underlying idea is sound and cheap to build: a `groupby(brand_name)` over talent-booking rows would let one Dell node aggregate multiple bookings (e.g., Pitbull in January, Flo Rida in May) automatically as Signal Stacks appends new rows — no manual upkeep. **Gated on data:** this requires a structured `talent_name` field in the Signal Stacks schema (currently talent bookings are free-text in `summary`). Until that field exists, "who was booked" isn't a queryable value, so there's nothing to group on.

### 10.3 Shared talent as a connector — descoped from full node-branching
Originally considered as a first-class talent node type (Dell and a competitor both connecting to a shared "Pitbull" node), which maps more literally onto the epidemiological-diagram reference. **Descoped per user judgment:** two brands independently booking the same artist for unrelated one-off engagements isn't a meaningful relationship signal on its own. The signal that actually matters is narrower: a **conflict-of-interest flag**, relevant specifically when a talent partnership (not a short-term booking) creates overlap between competing brands.
- Likely a flag/badge on the relevant brand nodes rather than a new node type or graph structure
- Should probably only trigger on **partnership-tier** relationships (ongoing/exclusive), not one-off bookings — which means the Talent Booking schema needs to distinguish booking type, not just log that a booking happened
- Worth revisiting once the Talent Booking rubric exists; not worth designing further in the abstract before then

### 10.4 Click-through: per-client talent history (resolves former open question #5, Talent side)
On clicking a node in the Talent zone, surface a simple list of known talent partners for that brand, sourced directly from Backbone Sheet rows matching that `brand_name` — talent name plus rough date (e.g., "Doja Cat — 6/24", "Halsey — 3/19"), sorted by recency. Works for both current clients and prospects (e.g., Alienware) equally — a filtered query against data Signal Stacks is already logging, not a new data source.

**High-volume handling — resolved:** show the last 5–10 chronological talent partners by default, with a "see full list" expand option for anything beyond that.

**Natural extension:** the most sensible place to surface the COI flag from 10.3 inline — if a listed artist also appears on a competing brand's list with an overlapping partnership window, flag it directly in this same panel rather than building separate UI for it.

---

## 11. Sequencing / workback

Cluster's real constraint is dependency order, not a calendar date:

- **Gate 0:** Signal Stacks reaches functional maturity — Phase 0 inputs arrive, lookalike scoring runs against real data for a few weeks. (D3 mechanics can be prototyped on dummy data in parallel without waiting on this.) **Update:** node/edge *data* no longer needs to wait on this — see the bootstrap note below.
- **Gate 1:** Data blockers in Section 7 resolve — NBD view is achievable once #1 and #4 clear; Leadership view additionally needs #2. **In progress:** Data Blocker #1 (per-client adjacent/competitor research) has started via a manual seed-data bootstrap — see `G7_Cluster_Study_Seed_Dataset.md` (prose/rationale) and `G7_Cluster_Study_Seed_Data.json` (structured node/edge format, D3-ready, now including `zone` assignments for all 11 Tier 1 hub nodes, plus real user-supplied `g7_notes` for 5 clients and a `corporate_parents` section — see below). Three clients are search-verified against current 2026 sources (White Claw, Liquid Death, Fireball); the remaining eight are drafted from stable category knowledge and flagged `"confidence": "established"` for a spot-check before being treated as final.
- **New finding — real corporate structure data.** The Section 6a mechanism (parent/subsidiary hulls, propagation) now has two real instances instead of a hypothetical: **Mark Anthony Brands** (parent of White Claw, Mike's Hard Lemonade, Cayman Jack, and Olé — all real, current G7 relationships, now all promoted to full hub nodes with their own competitor research) and **Intuit** (parent of TurboTax, with G7 working the relationship at both levels).
- **New concept — COI-sensitive competitors.** Raised directly by the user: for a client as significant as Mark Anthony Brands, direct competitors identified through normal lookalike research (Twisted Tea, Jose Cuervo, etc.) shouldn't be treated as standard outreach targets — pursuing them risks the primary relationship. Implemented as a `coi_sensitive` flag + note on the relevant `adjacent` entries in the JSON, rather than a new node/edge type — it's a caution flag on existing competitor data, not a new category of relationship. **Not yet decided:** whether this needs a visual treatment (e.g., a warning icon on COI-flagged edges) or stays purely a data-layer flag surfaced only in the click-through detail. Worth adding to the open questions list.
- **New relationship type — structurally analogous clients.** A third pattern distinct from `direct_competitor` and `analogous_audience`: two client relationships that aren't competitors and don't share an audience, but share a *business structure* G7 should think about similarly — e.g., Mark Anthony Brands and Swisher (via its child Mojo Energy) are both multi-brand parent clients where G7's approach looks similar across children. Tracked at the `corporate_parents` level (a new `structural_analogs` field), not between individual hub nodes, since the analogy is about the relationship shape, not the brands themselves.
- **New finding — a real RFP-lost example.** Subaru includes a genuine instance of the RFP-as-scoring-input mechanism (Section 6): G7 pitched Subaru for Talent Booking business and didn't close it. This is a real, ready-to-use test case for the lookalike-search pipeline once Gate 2 is reached, rather than needing a hypothetical like the Ultraman example.
- **Gate 2:** RFP-triggered lookalike pipeline (Section 6) scoped and tested against a handful of real past RFPs.
- **Gate 2a (new):** Parent/subsidiary mapping (Section 6a) scoped — a smaller, more contained research task than Gate 1's full competitor/analog research, since it only needs ownership relationships, not full competitive landscapes.
- **Gate 3:** Open questions in Section 9 resolved — several already closed this session (floor color, current/past client status, layout mechanism); remainder are cheap now, expensive to retrofit after nodes are live.
- **Gate 4:** Build, recommended in Claude Code (Section 8) once Gates 0–3 are sufficiently clear. Rough estimate: 10–16 hours for core D3 mechanics (anchored-position layout + lens dimming, ring/fill/floor grammar) + 4–7 hours for draggable nodes with return-to-home (Section 4b) + 8–12 hours for the RFP lookalike pipeline + additional time, not yet estimated, for the parent/subsidiary hull-grouping and propagation logic (Section 6a) given it's a genuinely new mechanic.
- **Gate 5 (Phase 3):** Launch NBD view first; Leadership view once revenue data exists.

**Bootstrap rationale:** since Signal Stacks will take time to build up steam, Cluster's node population doesn't need to wait for it — the manual case-study/AI-assisted lane (one of the three original data-entry paths) can run independently now. These become permanent floor-state nodes (Section 5) with no ring or relevance decay; Signal Stacks later lights up rings/fill on top of the same brands as live signals arrive, rather than creating the nodes from scratch.

**Session 1 build scope (decided in a later planning session):** core D3 mechanics (Section 4, anchored layout + lens dimming + ring/fill/floor grammar), draggable nodes with return-to-home (Section 4b), the Sheets ingestion pipeline (Section 7 update / Section 8), NBD's hub-and-spoke view (Section 3), the RFP lookalike pipeline (Section 6, Gate 2), and corporate structure/hull grouping (Section 6a, Gate 2a) are all in scope for the first Claude Code session. Leadership's portfolio view (Phase 3, Gate 5) is explicitly out of scope until revenue data exists.

---

## 12. Flags for the Signal Stacks thread

These items surfaced in Cluster planning but are implementation work that belongs in the Signal Stacks build, not here:

1. **Sister-agency "warm path" signal** (Project Worldwide relationships) was already noted in the master plan as a candidate third anchor signal for Signal Stacks' core scoring rubric. As of this session, this is now understood as one instance of the general **connection-distance mechanism** (Section 6a) shared with parent/subsidiary corporate structure — worth designing the propagation logic (three-step schema, two-hop cap) once, and applying it to both sister-agency and corporate-structure edges, rather than building two separate mechanisms. Still blocked on the sourced sister-agency client list (Section 7, #3).
2. **RFP tracker as a Signal Stacks input source.** Section 6 treats the RFP tracker as a Cluster scoring input, but there's a reasonable argument it should also feed Signal Stacks' own lookalike scoring directly. Worth deciding in the Signal Stacks thread whether this is one ingestion pipeline feeding both systems, or two separate integrations.
3. **Lookalike scoring stability is a hard prerequisite for Cluster**, per Gate 0. Any changes to the lookalike scoring rubric after Cluster is built will require rework on the Cluster side. Worth flagging that the rubric should be considered close to stable before Cluster building starts in earnest.
4. **Outcome tracking column** (open risk #2 in the master plan — `contacted/pitched/won/ignored`) becomes more valuable once Cluster exists, since it could double as an input to Cluster's relevance/signal-strength scoring, not just Signal Stacks ROI assessment.
5. **Talent Booking schema needs two additions once the rubric is built** (Section 10): a structured `talent_name` field, and a way to distinguish **booking type** — one-off engagement vs. ongoing/exclusive partnership. Both are needed for Cluster's Talent-side refinements, but they're schema decisions that belong in the Talent Booking rubric design, not retrofitted after the fact.
6. **Scout vocabulary enrichment (ancillary, low priority).** Once the `talent_name` field exists, a simple scheduled (cron-pull, not real-time) diff could feed newly-identified artist names from the Backbone Sheet into Scout's entity vocabulary. No urgency; worth doing once Scout and Signal Stacks are both stable, not before. Depends on knowing how Scout's vocabulary is currently stored — not yet confirmed.
7. **New — ownership-change extraction.** Section 6a.5 proposes adding an ownership-change extraction category (acquirer, acquired entity, date) to the existing RSS/Haiku pipeline, with a human-approval gate before it mutates Cluster's parent/child graph. Worth scoping alongside the existing extraction categories rather than as a fully separate pipeline.

---

*Companion doc: `G7_Signal_Stacks_and_Cluster_Study_Master_Plan.md` (Signal Stacks detail, Part 1) and `G7_Verticals_Lookalike_Analysis_DRAFT.md` (Tier 1 client/vertical analysis referenced in scoring). Data artifacts: `G7_Cluster_Study_Seed_Dataset.md` and `G7_Cluster_Study_Seed_Data.json`.*
