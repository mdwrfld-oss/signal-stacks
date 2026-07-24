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
**⚠ SUPERSEDED — see Part II, Section II.5.** Permanent dragging is reversed; positions become fixed once they carry vertical-score meaning. Left here for historical context only; do not build against this section.

Inspired directly by Obsidian's graph view. Nodes can be grabbed and dragged to temporarily rearrange the map — neighboring nodes respond naturally via the existing link/charge/collision forces during the drag, same visual language as Obsidian — and on release, the anchor force (4, above) eases the node back to its default position rather than leaving it wherever it was dropped. This gives users a way to manually declutter or explore a dense area (e.g., pulling the Mark Anthony Brands hull apart to see it more clearly) without permanently disrupting the layout others rely on for spatial memory.
- **Estimated add: 4–7 hours** on top of core mechanics — anchor-force setup/tuning, drag handlers, making hull boundaries (6a.1) and connector lines recompute live during a drag rather than only rendering once, and general smoothness tuning.
- **Not yet decided:** whether a subtle idle drift (very low-amplitude motion around the home position, distinct from drag) is worth adding for the "alive" feel Obsidian has at rest, or whether the anchor force should hold nodes fully still until actively dragged. Low-cost either way; worth deciding once the core drag mechanic is working and can be felt rather than imagined.

### 4c. Snap-to-grid dragging (added this session, from live-build feedback)
**⚠ SUPERSEDED — see Part II, Section II.5.** Permanent user repositioning of any kind is reversed. Left here for historical context only; do not build against this section.

On release (not mid-drag, to keep movement fluid), a dragged node snaps to the nearest **unoccupied** point on an invisible positioning grid — similar to icon repositioning on a desktop OS. Nearest-point snapping alone isn't sufficient, since it can collide two nodes into the same cell; snap logic needs an occupancy check with fallback to the next-nearest free cell. Grid spacing should be tied to typical node radius/label width so cells are meaningfully spaced apart. Estimated: 2–3 hours.

### 4d. Label and node collision avoidance (added this session, from live-build feedback)
Distinct from 4c — this needs to be **always-on**, not just a response to manual dragging, since the default auto-generated layout can produce overlapping labels on its own (seen directly in the first build's Cayman Jack/Olé cluster, where competitor labels crowded and overlapped). Requires a dedicated collision force operating on label **bounding boxes**, not just node circles — text is wider than the circle it's attached to, and the existing `forceCollide` on nodes alone won't prevent label overlap. Runs continuously as part of the simulation tick, not as a one-time cleanup pass. Estimated: 3–5 hours, likely the most iteration-heavy piece of this round of refinements.

### 4e. Cluster spacing tuning (added this session, from live-build feedback)
Default spacing between distinct clusters (each parent-family group, and each standalone hub node) should start with more breathing room — a global tuning pass on repulsion/link-distance forces rather than a new mechanic. **Estimated: ~1 hour.**

### 4f. Vertical sectors (added this session)
**⚠ SUPERSEDED — see Part II, Sections II.1–II.2.** Single-vertical-per-node sector assignment is replaced by weighted multi-vertical scoring across two separate maps. Left here for historical context only; do not build against this section.

New spatial layer, proposed alongside the stellar-cartography aesthetic direction (5c): six verticals — Food & Beverage, Automotive & Transportation, Technology & B2B, CPGs, Sports, Hospitality/Travel/Tourism — each occupying a defined region of the canvas, similar to quadrants on a star chart.

**Resolved approach: true spatial sectors, not just background tinting.** Each node's anchor position (4) is pulled toward its vertical's sector region via an additional force, layered on top of the existing anchor-to-home and orbit-around-parent forces. This is the more literal match for the astronomical reference and produces a genuinely useful side effect: a `direct_competitor` edge staying within one sector is visually unremarkable (expected), while an `analogous_audience` edge stretching *across* sectors becomes a visible signal in its own right — e.g., a future Subaru → outdoor-lifestyle-brand connection reading as a visible "trade route between different customer galaxies," which is exactly the kind of parallel-lane insight Cluster exists to surface. Sector boundaries render as faint grid/quadrant lines with small corner labels, not solid color fills — solid fills would compete with node fill color, which already carries relevance/identity meaning (Sections 5, 5a).

**Resolved:**
- **CPGs is scoped to non-food packaged goods** — skincare, toys, household products, etc. — distinct from Food & Beverage. Given the current roster, this means every current beverage/spirits hub node (White Claw, Mike's Hard Lemonade, Cayman Jack, Olé, Fireball, Liquid Death, Lagunitas, Mojo Energy) belongs in **Food & Beverage**, and **CPGs currently has no hub node**, same as Sports.
- **Empty sectors (Sports, CPGs) are fine for now** — not a bug, just reflects where G7's current roster actually sits. Both sectors still render as defined regions on the sector chart, ready to receive nodes as the roster grows.

### 4g. Additional view toggles (added this session)
Two new toggles, layered onto the existing Experiential/Talent lens (Section 4) as independent, combinable filters rather than replacements for it:

- **Signals-only toggle:** dims every node without an active signal (no ring present), leaving only signaled nodes at full strength. Must combine with the existing lens rather than override it — e.g., "Signals-only + Talent" shows only nodes that are both in the Talent lens *and* currently signaled, at full opacity; everything else dims.
- **Competitor-dim toggle:** dims competitor/adjacent nodes for a cleaner view focused on G7's own roster. When active, competitor **labels are fully hidden** (not just faded), not merely dimmed like the lens treatment — the intent is a decluttered view, not a partial one.

**Combination logic:** all active filters apply multiplicatively — a node renders at full strength only if it passes every currently-active filter (lens, signals-only, competitor-dim); otherwise it dims. This keeps the three toggles composable rather than needing special-cased interactions between them.

### 4h. Selection highlights connectors (added this session, from live-build feedback)
Generalizes structural-analog highlighting's original approach beyond that one now-removed relationship type: **selecting any node highlights all of its connected edges** — competitor links, analogous-audience links, parent/subsidiary links, everything currently attached to it — with everything else dimming slightly to make the selected node's relationships legible at a glance. **Note (2026-07-20):** structural-analog highlighting itself (6a.7) has since been removed entirely, but the general rule this section describes stands unaffected — it was already designed as one case of this broader mechanism, not the mechanism itself.

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

### 5a. Client identity marker (added this session, from live-build feedback)
**⚠ SUPERSEDED — see Part II, Section II.3.** Purple-as-client-identity is replaced by white (client) / medium gray, fading with age (signal) — purple is now reserved as the Business Landscape's selection/lens accent color, not a base fill. Left here for historical context only; do not build against this section.

The first live build rendered every node in floor-gray by default, which surfaced a real gap: a genuine G7 client shouldn't be visually indistinguishable from a random competitor node just because Signal Stacks hasn't detected a live signal about it yet. Resolved: any node that is a **real, confirmed G7 client relationship** gets a base fill of G7 purple — always, regardless of live-signal status — with the existing relevance formula (signal_strength × recency decay) still modulating *shade within that purple family*. Floor-gray is reserved strictly for nodes that are not G7 clients (competitors, analogs, corporate parents that aren't themselves direct clients).

**Confirmed owned-client list (13):** Cayman Jack, Mike's Hard Lemonade, White Claw, Fireball Whiskey, Liquid Death, Mojo Energy, Ram Trucks, Lagunitas, Subaru, Jackson Hole Mountain Resort, Atlassian, Workday, Cisco. TurboTax/Intuit remains floor-gray given its lapsed status. Implemented as `is_g7_client` (boolean) on every hub node in the seed JSON.

**Estimated: 1–2 hours** to wire the rendering rule now that the client list is finalized.

**What happens when a current client gets a Signal marker (answered this session):** nothing special — clients follow the exact same overlay logic as any other node, they just start from a purple floor instead of a gray one. A signal on an owned client: (1) activates its ring, same mechanism as any signaled node, and (2) darkens its fill further within the purple family per the existing relevance formula. The client identity marker never gets overridden or replaced by a live signal — it's a permanent base layer that live signals layer on top of, not a competing state.

### 5a.1 Sister-agency ring — unblocked with real examples (added this session)
**Resolved this session:** ring color set to G7's red brand color, `#B83A1A` — clears the yellow conflict with the Cultural Landscape's accent color (Part II, II.3).

Data Blocker #3 (Section 7) required a sourced sister-agency client list before this ring type could go live. Two confirmed examples now exist directly from the user: **Subaru and Lagunitas** are sister-agency clients (Project Worldwide relationships), and should render with a **red ring (`#B83A1A`)**. Implemented as a `sister_agency: true` flag on both hub nodes in the seed JSON. This doesn't fully clear Data Blocker #3 (the full Project Worldwide client list is still unsourced), but it's enough real data to make the ring type demonstrable rather than purely theoretical.

### 5b. Drop shadows for parent and client nodes only (added this session, from live-build feedback)
Subtle drop shadows applied to parent entity nodes (Mark Anthony Brands, Intuit, Swisher) and owned-client nodes (`is_g7_client: true`) — reinforces the same distinction as the purple identity marker (5a), giving real G7 relationships and their organizing parents a slight visual "lift" off the canvas. Competitor/adjacent nodes and floor-state nodes stay flat, no shadow — keeps the visual hierarchy consistent with the color distinction rather than working against it. **Estimated: ~1 hour.**

### 5c. Stellar cartography aesthetic (added this session)
Overall visual direction, inspired by astronomy charts / Star Trek-style stellar cartography — coheres well with mechanics already in place (orbital parent/child layout, ring grammar) rather than requiring rework:
- **Dark canvas** replacing the current light background — reinforces "star map" over "flowchart" immediately
- **Nodes as glowing points** (radial gradient / soft glow filter) rather than flat-fill circles, especially on `is_g7_client` and parent nodes — this can likely *replace* the flat drop-shadow treatment from 5b with something more on-theme; worth deciding once both are visible side by side
- **Edges as faint "trade routes"** — thin, slightly luminous lines rather than plain strokes; the selection-triggered edge highlight (§4h) fits naturally as a "warp lane" motif that only appears on demand
- **Sector boundaries (4f) as faint grid lines with corner labels**, not solid fills, consistent with keeping node fill color free to carry relevance/identity meaning
- **Revisits the open idle-drift question (4b):** this aesthetic is the strongest argument yet for subtle ambient motion at rest — stars drift gently in every reference for this style, and the mechanism already exists via the anchor-force system, so this may now be worth resolving in favor of "yes, drift" rather than leaving it open indefinitely

### 5d. Label typography hierarchy (added this session)
Permanent style change, independent of the competitor-dim toggle (4g) — competitor/adjacent node labels render **significantly smaller** than client/hub node labels by default, establishing a clear graphic hierarchy where competitor entities are visually subordinate to G7's own roster at all times, not just when the competitor-dim toggle is active. Pairs with the existing purple-vs-gray (5a) and drop-shadow (5b) distinctions — all three should reinforce the same hierarchy (client entities prominent, competitor entities present but secondary) rather than any one of them working against the others.

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

### 6a.1 Visual treatment — orbital layout (revised this session, from live-build feedback)
**⚠ SUPERSEDED — see Part II, Section II.4.** Fixed single-radius orbital slots are replaced by independently-computed child positions plus concentric distance rings as a visual aid; the parent's position becomes the centroid of its children. Left here for historical context only; do not build against this section.

**Original approach (superseded):** a convex-hull boundary (`d3.polygonHull()`) drawn around a parent and its children. In practice, this produced tangled connector lines and label crowding around the parent (visible directly in the first build's Mark Anthony Brands cluster).

**Revised approach:** children render in an **orbital layout** — fixed angular slots around the parent at a defined radius, similar to a solar-system diagram, rather than a loose blob boundary. This is inherently tidier: each child has a defined "slot" rather than competing for space wherever the force simulation happens to settle it, and it reads more immediately as "these belong to this parent" than a soft boundary does. An optional dashed orbit-path circle can render behind the children for additional visual clarity, echoing the reference diagram style.

**Larger parent node radius:** parent entity nodes (Mark Anthony Brands, Intuit, Swisher) should render at a visibly larger radius than standard hub or adjacent nodes — a simple size-scale rule keyed to node type (parent vs. hub vs. adjacent-brand), reinforcing their role as an organizing structure rather than a peer node.

**Estimated: 4–6 hours** — radial positioning logic to replace the hull, larger-radius scaling rule, optional orbit-path rendering.

### 6a.1a Orbit exclusion zone (added this session, from live-build feedback)
**⚠ SUPERSEDED — see Part II, Section II.4.** A single-radius exclusion boundary doesn't translate to the new concentric/independent-position model; needs fresh design once II.4 is actually rendered. Left here for historical context only.

A real problem surfaced in the live build: competitor/adjacent nodes belonging to a *child* (e.g., Twisted Tea, orbiting near Mike's Hard Lemonade) were visually falling inside the parent's orbit ring — implying they're affiliated with the parent (Mark Anthony Brands) itself, which is false and actively misleading. **Resolved:** the parent's orbit radius acts as an exclusion boundary — any non-family node (a competitor/adjacent node not belonging to this parent's cluster) that falls within that radius gets pushed outward until it clears the boundary, similar to a collision force against a fixed circular obstacle rather than another node. This needs to apply per parent cluster (Mark Anthony Brands, Intuit, Swisher each maintain their own exclusion zone). **Estimated: 2–3 hours**, layered onto the orbital layout work above.

### 6a.1b Orbit-locked dragging for child entities (added this session, from live-build feedback)
**⚠ SUPERSEDED — see Part II, Sections II.4–II.5.** Both the fixed-radius orbit concept and permanent dragging itself are reversed. Left here for historical context only; do not build against this section.

Refines the general draggable-node behavior (4b) specifically for children within an orbital group. A child can be dragged **around** its parent's orbit path — angular position changes freely during drag — but not permanently pulled closer to or farther from the parent than the orbit radius allows. On release, if the drop point isn't exactly on the orbit circle, the child snaps to the **closest point on its parent's orbit radius** (project the drop position onto the circle, preserving the angle, normalizing the distance) rather than back to its original angular slot. This lets a user reorder or spread out children around a crowded parent (useful for the Mark Anthony Brands cluster specifically) without ever letting a child drift away from or into the parent entirely.

### 6a.2 New edge type
`parent_of` / `subsidiary_of` — distinct from `direct_competitor` and `analogous_audience`, since it's a structural relationship, not a competitive or audience one.

### 6a.3 Signal propagation — three-step schema (resolved this session)
**⚠ NEEDS RE-EXPRESSION — see Part II, Section II.3.** The underlying concept (reduced-intensity propagation to parent/siblings) is still valid, but the multipliers below were defined against purple fill-darkness, a channel that no longer exists in the new white/gray glow model. Re-express in terms of gray-glow opacity before implementing.

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

### 6a.7 Rendering structural analogs — REMOVED 2026-07-20 (was: selection-triggered, not persistent)
**⚠ REMOVED — do not build.** Structural analogy as a relationship type has been dropped entirely, along with the `structural_analogs` field in the seed JSON. Reasoning: unlike `direct_competitor`/`analogous_audience`, which are defensible from observable market facts, structural analogy was an inherently subjective judgment call that visually implied a factual relationship it wasn't — not appropriate ahead of a broader team showing. Original spec preserved below for historical context only; the "general pattern worth reusing" idea (selection-triggered rendering for non-spatial relationship types) remains valid in principle even though this specific instance is gone.

~~Structurally analogous clients (Section 11's `structural_analogs` field — e.g., Mark Anthony Brands ↔ Swisher) are a fundamentally different kind of relationship from `direct_competitor`/`analogous_audience` and from `parent_of`, and need different visual treatment:~~

- ~~**Not physical proximity.** Unlike parent/subsidiary hulls, structural analogs should *not* pull nodes close together in the force layout.~~
- ~~**Not a persistent line either.** A permanent connecting edge between every structurally-analogous pair would clutter the graph.~~
- ~~**Resolved approach: selection-triggered highlight.** Structural-analog connections render only when a node is actively selected/clicked.~~
- **General pattern worth reusing:** this selection-triggered-only rendering is a reasonable model for any relationship type that's real and useful but not spatially meaningful — worth keeping in mind if other non-spatial relationship types emerge later.

## 6b. Signal Stacks ingestion (added this session)

This was already the intended long-term data architecture (Section 8 — reading live from the same Backbone Sheet via Signal Stacks' existing Service Account/JWT pattern), now being implemented directly.

**Mechanism:** fetch Backbone Sheet rows, match `brand_name` against Cluster's full node set (both hub nodes *and* adjacent/competitor nodes — a signal can land on a floor-state competitor just as easily as an existing client). On match: activate that node's ring and feed `signal_strength`/recency into the existing relevance formula (Section 5).

**Real implementation risk worth flagging:** name matching. "White Claw" in the Sheet vs. "White Claw Seltzer" in a headline, punctuation/casing differences, etc. Needs either fuzzy matching or a small manual alias table per node — Claude Code should flag ambiguous matches rather than silently guessing on a fuzzy match it isn't confident about.

**Given the near-term demo (Julie, tomorrow):** recommend a two-step path rather than building the full live pipeline under time pressure tonight:
1. **Fast path for tomorrow:** manually export the current Backbone Sheet (Google Sheets → File → Download → CSV, or just share the relevant range) and hand it to Claude Code as a static file for a one-time ingestion pass. Avoids debugging live Service Account auth on a deadline — same matching/rendering logic either way, just a simpler data source for now.
2. **Proper pipeline, after the demo:** wire the live Service Account fetch per the original Section 8 architecture, so Cluster stays current automatically as Signal Stacks appends new rows, rather than needing repeated manual exports.

## 6c. On-demand "Generate Competitors" (added this session)

New interactive feature for the click-through detail panel: for **Signal-sourced entities** specifically, add a "Generate Competitors" button at the bottom of the node's detail view. On click, it triggers an AI-powered search (Claude API + web search, same pattern as the RFP lookalike pipeline in 6.1) to find 3–5 real competitors for that brand and offer to add them to the map.

**Behavior:**
- Button appears only on nodes with an active Signal ring (per 5a.1's simplified ring system) — this is meant to extend the map outward from real, current signals, not to be a general-purpose "research any node" button.
- On click, show a **"Searching…" animation** in the panel while the API call is in flight — the search may take a few seconds, and the UI shouldn't look frozen or unresponsive during that time.
- Returned candidates are checked against the existing node set before anything is added: **if a candidate brand already exists on the map, connect to it instead of creating a duplicate node.** Only genuinely new brands get created as new nodes.
- New nodes generated this way follow the same rules as any other node — floor-gray by default (no signal of their own yet), standard competitor label sizing (5d), no drop shadow (5b) unless/until they become a client.

**Infrastructure note:** this needs a backend proxy, not a direct client-side API call — an exposed API key in frontend code is a real security problem, not just a style preference. G7 already has the right pattern for this: reuse the same Cloudflare Worker proxy approach already running for Scout (`scoutproxy.matt-weiner-5c1.workers.dev`) rather than building new infrastructure from scratch. The Worker receives the brand name, runs the Claude API + web search call server-side, and returns structured results to the frontend.

**Relationship to 6.1:** this is functionally the same lookalike-search mechanism already designed for RFP-triggered lookalike search (6.1), just re-triggered manually from the UI per-node rather than automatically from an RFP event. Worth building the underlying search/classification logic once and calling it from both triggers, rather than maintaining two separate implementations.

## 6d. Easter egg — idle starship (added this session, low priority, bundle into a future build pass)

Purely optional visual polish, fully decoupled from the data/simulation logic — safe to defer indefinitely without blocking anything else.

**Behavior:**
- After a period of user inactivity (mouse/keyboard/click), a small ship drifts slowly between random points on the visible canvas, through the empty space between entities — fits the stellar-cartography aesthetic (5c) as "something out there in the dark."
- On any user activity resuming (mousemove, click, keypress), the ship "goes to warp" — a fast, elongated streak (scale/blur toward its direction of travel) that rockets off-screen in well under a second, then gets removed.

**Asset:** the user has a file, `Enterprise.png`, to use for the ship — reference it directly (`<img>` or SVG `<use>`) rather than generating a replacement. **Sizing:** small, but not so small the ship is unrecognizable — should read clearly as a ship silhouette at a glance, not just a nondescript dot.

**Copyright note for future reference:** the Enterprise design is Paramount/CBS-owned IP. For this tool's current scope — internal only, ~10 users — practical risk is negligible and the user has confirmed they're comfortable with it. Worth reconsidering if this tool's audience or visibility ever expands beyond the current internal, small-scale use (e.g., external demos, wider company rollout, public screen-shares).

**Estimated: 2–3 hours.** Bundle into a future instruction set alongside other pending revisions rather than shipping standalone.

## PART II: Map Engine v2 — Dual Gravity-Well Maps (added this session)

Prompted by a separate ideation conversation working through how to make Cluster genuinely distinctive as an NBD tool rather than a prettier CRM. This is a foundational change to what "position" means, not an additive feature — several Part I decisions are directly superseded (flagged at the relevant Part I subsections) rather than layered on top of.

### II.1 Data model: weighted vertical scoring, not single categorical assignment
Each hub node's single `vertical` field (Part I, 4f) is replaced by two scored objects — every entity gets a **0–5 score against every vertical**, not one assigned category:
```
business_verticals: { food_beverage: 5, entertainment: 1, retail: 1, ... }
cultural_verticals: { music: 4, sports: 5, gaming: 3, ... }
```
**Storage resolved:** stored internally as normalized 0–100% weights, displayed to users as 0–5. A hybrid brand (e.g., Liquid Death: Food & Beverage 5, Entertainment 3–4) naturally sits between wells rather than being forced into one category — this is the mechanism that makes position meaningful rather than arbitrary.

**Position-weighting resolved and BUILT 2026-07-20 (Option C).** A flat weighted average across all 9/13 wells caused severe congestion — nearly every entity carries *some* nonzero score in most wells, so raw proportional weighting packed every scored entity within 24% of the well radius (confirmed by measurement). Resolved: only an entity's top-scoring wells should meaningfully pull its position; low scores shouldn't dilute it toward center. **Built implementation:** a sharpening exponent applied to each score before normalizing weights (`score^2.6`, tunable via `CULT_SCORE_GAMMA` in `app.js`) — a 5 now pulls disproportionately harder than a 3, with no hard threshold or top-N cutoff needed. Result: mean pairwise distance went from 135px to 299px; entities now reach ~70% of the way to their dominant well(s); near-tied profiles (e.g., Workday/Cisco/Atlassian, all genuinely similar tech-B2B cultural profiles) still correctly cluster together, while genuinely different profiles separate. Stored 0–5 scores and the panel display are unaffected — this is purely a position-computation transform, not a data change. `CULT_SCORE_GAMMA` should be treated the same as the recency-decay half-life — a real tuning parameter, not a settled constant, worth revisiting once more real data exists.

**Position's actual purpose, reframed 2026-07-12 (supersedes the original "compare entities" framing):** position in the default Constellation view is a per-entity diagnostic, not a comparative ranking — it answers "where does this one entity sit," triggered by that entity's own Signal, not "who's stronger than whom" read across the whole map. Precise, comparable, per-category truth moved to the radar chart and click-through detail panel instead. Full resolution, including ghost mode and the detail-panel radar chart, is in the new **II.14** below.

**Business vs. cultural profile split (agreed, mechanism confirmed this session):** deliberately treated as two separate, independently-scored profiles — what a company *sells* vs. how it *behaves as a marketer*. The split is somewhat arbitrary at the edges by nature, and is handled by a new **LLM search-and-analysis enrichment layer** applied to every entity (and every Signal Stacks–surfaced signal) before induction into Cluster — see II.8 and II.11.

### II.2 Two maps, same entities, two positions
- **Business Landscape** — position = weighted average toward fixed business-vertical well anchors. Answers "what does this company do."
- **Cultural Landscape** — position = weighted average toward fixed cultural-vertical well anchors (Music, Sports, Comedy, Gaming, etc. — list still pending, II.10). Answers "how does this company behave as a marketer."
- **Same underlying node set, relationships, and click-through data** — only the computed coordinate changes. A map toggle animates every node flying between its two positions; the *distance* a node travels between maps is itself informative (a beverage company that barely moves is conventional; one that flies toward the Cultural map's Music/Entertainment wells is behaving unusually for its category).
- **Gravity wells are attractors** — ambient influence points. **Updated 2026-07-20:** all 13 cultural wells now render as persistent faint yellow cartographic labels around the map's edge at their true bearings (cultural map only, included in the fitted default view, fade out on the Business toggle) — superseding the earlier "labeled only on selection" plan. Selecting/isolating a well lights its label up at full accent on top of this ambient state, rather than being the only way a label appears.
- **This replaces Part I 4f's single-sector-force model entirely** — see the flag at 4f.

### II.3 Color/glow model (resolved this session — replaces Part I 5a/5c's color scheme)
- **Background:** black with subtle stars, **identical in both maps** — no purple-vs-yellow theme split between the two maps. This supersedes the earlier "purple business map / yellow cultural map background" idea from the ideation conversation.
- **G7 clients:** glow **white**.
- **Signaled entities (non-client, has an active signal):** glow **medium gray**, fading (lower opacity) as the signal ages — consistent with the existing recency-decay principle, just re-expressed as glow opacity rather than the old purple fill-darkness gradient.
- **Selection accent:** a selected entity glows in its map's accent color — the map's identity color lives in interaction feedback, not in the base palette. **Hex values locked 2026-07-11:** Business Landscape accent = `#9a6cd3ff` (purple); Cultural Landscape accent = `#ffd22eff` (yellow). Distinct from — and takes precedence in this map-accent role over — the older G7 brand purple (`#976CD0`) used elsewhere in the org's visual identity; the two are not required to match.
- **Vertical-lens illumination:** selecting a well (e.g., "Music") lights up the affected network in that map's accent color, saturation scaled to each entity's affinity score for that well. See II.13 below — formalized this session into a concrete UI spec (gravity-well isolation buttons), Cultural Landscape only for the first build pass.

**Resolved this session:** the Sister-agency ring (Part I, 5a.1) is set to G7's red brand color, `#B83A1A` — clears the conflict with yellow now being the Cultural map's own accent.

**Also needs reconciliation, not yet decided:**
- **Floor-state nodes** (no client, no signal at all) — what do they glow, if anything, under this new white/gray model? Not specified this session.
- **Drop shadows (Part I 5b)** — may be redundant now that white/gray glow itself carries the "lift" the shadow was doing. Worth deciding once both are visible together rather than assuming.
- **Existing Signal ring / propagation multipliers (Part I 6a.3, three-step 1.0/0.5/0.25 schema)** — conceptually still valid (a signal on a child should still propagate reduced intensity to its parent/siblings), but needs re-expression in terms of gray-glow opacity rather than purple fill-darkness, since that channel no longer exists in this model.

### II.4 Family/orbit rendering — concentric rings, not a single fixed-radius orbit (revised this session)
**Superseded:** Part I 6a.1's fixed angular slot at one orbit radius, and 6a.1a's single-radius exclusion zone, and 6a.1b's orbit-locked dragging — none of these survive as specified, since children no longer share one orbit radius.

**New model:** each child gets its own **independent semantic position** from its own vertical scores (II.1) — a Mark Anthony Brands child could land anywhere on the map depending on its own profile, not confined to a fixed ring around the parent. Since the parent (Mark Anthony Brands, Intuit, Swisher) likely has no strong identity of its own, **the parent's position is the centroid — the average — of all its children's positions**, recalculated per map (a parent's Business Landscape position and Cultural Landscape position are two different centroids, computed independently). Family grouping is then visualized as **concentric distance rings** around that centroid — similar to a solar system's varying orbital rings — purely as a rendering aid showing "these are siblings, at their true, independently-computed distances from their shared center," not as a mechanism that determines position.

**Needs fresh design work, not carried over from the old model:** the exclusion-zone concept (6a.1a) doesn't translate cleanly to a multi-radius concentric system — worth revisiting once this is actually rendered rather than guessing at a replacement now.

### II.5 Dragging policy — fixed positions, no permanent repositioning (resolved this session)
**Superseded:** Part I 4b (draggable nodes with return-to-home) and 4c (snap-to-grid) are both reversed. Once position carries real analytical meaning (II.1–II.2), permanent user repositioning would corrupt that meaning — a user couldn't tell whether two nodes are adjacent because of genuine business/cultural similarity or because someone dragged one for readability.
- Positions become **fixed**, computed entirely from vertical scores (plus the family-centroid adjustment, II.4).
- Temporary inspection dragging (an "elastic tether" — pull a node to see it more clearly, it springs back on release or reload, never saved) remains a reasonable option if crowding becomes a real problem, but this is not a commitment yet — pan/zoom (Part I 4a, still valid) may be sufficient on its own.
- **4d (label/node collision avoidance) and 4e (cluster spacing tuning) are unaffected by this change** — both remain necessary regardless of how position is computed, since labels can still collide even at fixed coordinates.

### II.6 Signal vectors (arrows) — resolved decay schedule
A new signal (e.g., a musician partnership) creates a temporary directional arrow toward the relevant cultural well, separate from and prior to any change to the entity's actual identity score — prevents one announcement from overcorrecting a stable position.

**Decay schedule (resolved this session):** arrows decay in **4-week (monthly) increments, across 6 levels** — a 24-week (6-month) total window, each level presumably a step down in arrow brightness/length/opacity. **After 6 months, a similar signal recurring is treated as a fresh, isolated one-off** — it does not inherit or build on the prior arrow's accumulated momentum. Sustained signals *within* that 6-month window (multiple reinforcing events) are what should eventually promote an arrow into an actual identity-score change, not a single event at any point.

**Not yet decided:** the exact shape of the 6 levels (linear step-down vs. front-loaded/back-loaded), and whether decay rate should vary by signal type (a music partnership vs. a CMO hire plausibly decay differently) — flagged as a future refinement, not blocking.

**BUILT 2026-07-20.** Live on the Cultural Landscape only, per spec: yellow arrows from entity to well(s), linear 4-week/6-level decay confirmed as built (front/back-loading and per-type rates remain the open refinement above), fully gone at 24 weeks, dims correctly with the existing view filters. **Data contract:** `signal.cultural_wells`. Since classifying a signal into wells is properly CAP's job (see Part III) and CAP doesn't exist yet, the 4 currently-live signals were **hand-tagged as clearly-marked provisional stand-ins** (`PROVISIONAL_WELL_TAGS` in the ingest script) rather than left unclassified: Stella Artois → Sports + Festival (World Cup pop-up bar); PLL → Talent & Celebrity Partnerships (Glen Powell/Rob McElhenney); Ulta Beauty → Creator & Influencer Partnerships (TikTok Shop); Reddit → Festival (Cannes activation). **Reviewed 2026-07-20, all four confirmed:** Stella, PLL, Ulta, and Reddit → Festival all read as reasonable calls from their evidence — Reddit's Cannes tag specifically reconfirmed as fine despite Cannes Lions being an advertising-industry event rather than a purely consumer-facing festival; the taxonomy's Festival category (Cultural Affinity Processor spec §4) is broad enough to cover it as scored. This provisional-tagging approach should be explicitly noted in the CAP build brief as the interim mechanism it's meant to eventually replace.

### II.7 "Notable factors" — REPLACES the G7 Gravity composite score (resolved 2026-07-20)
**⚠ SUPERSEDED.** The original concept — a computed 0–100 composite score with a weighted factor breakdown and rising/stable/falling trend — is replaced entirely, not tuned. Original spec preserved below for historical context.

~~A computed 0–100 "how strategically relevant, commercially plausible, and timely is this company for G7 right now" score, shown in the click-through panel alongside a factor breakdown (capability fit, recent momentum, commercial potential, relationship access, lookalike strength, opportunity timing) minus a constraint penalty (COI, entrenched agency, procurement friction), plus trend/trajectory.~~

**Why it's being replaced, not fixed.** Two problems, one conceptual and one concrete. Conceptually: synthesizing "is this a good opportunity" is NBD's actual job, and it depends on qualitative judgment (relationship warmth, timing politics, budget cycles, competitive dynamics) that doesn't compress into a weighted sum without pretending to more certainty than exists — several of the built factors were already numeric placeholders measuring nothing (commercial potential defaulting to a neutral 7.5/15 with no revenue data; momentum flatlining at 0/20 for any entity with no live signal). Concretely: the live build's Lookalike Strength factor was still reading from `structural_analogs` at the moment this decision was made — a relationship type removed earlier this same session for being subjective judgment dressed up as data. That's not a hypothetical risk about composite scores drifting stale, it's the same failure mode having already happened once, inside this exact feature, within one session.

**Replacement: a plain, unscored list of true/applicable facts — working name "Notable factors" (rename freely).** No math, no weights, no composite, no verdict. Each line either applies to the entity or doesn't appear at all:
- Existing G7 client
- Sister-agency relationship (only shown if true)
- Signal detected — [time elapsed], evidenced for [well name] (only shown if a live signal exists)

**COI flag deliberately excluded, removed 2026-07-20** (was briefly included, see Section 9 open question #14 for the full reasoning) — a brand-level conflict-of-interest marker can't accurately represent reality when a brand spans multiple product lines, only some of which genuinely conflict with a client relationship. NBD's own judgment covers this better than a flag that risks being wrong in either direction. Distinct from the narrower, still-valid talent-partnership-overlap COI concept in Section 10.3/10.4, which is unaffected.

**Deliberately excluded:** cultural-strength facts (e.g., "top cultural score: 5/5") — the radar chart already sitting in the same panel (II.14) shows this visually; repeating it as a text bullet is redundant, not additive. Also excluded: anything that was previously a proxy/placeholder (neutral-default commercial potential, momentum's 0/20 floor, the trend badge) — none of that scaffolding is needed once nothing is being summed into a headline number.

**Code follow-up:** `gravity.js`'s composite scoring and weighted-factor math should be removed, not just have its inputs patched — this is a structural replacement of the feature, not a data fix. The "basis"-line proxy-labeling discipline that made the old version at least honest about its own uncertainty is worth carrying forward as a general principle for any future score, even though this particular score no longer exists.

### II.8 Business vs. cultural classification pipeline
Confirmed mechanism: an **LLM search-and-analysis layer** assesses every entity (and every Signal Stacks–surfaced signal) against both the business-vertical and cultural-vertical taxonomies before it's inducted into Cluster or its scores are updated. This is real research work per entity (sponsorship history, festival activity, talent partnerships, product-line composition), not a lookup — see II.11 for what this means for the Signal Sweep pipeline specifically.

### II.9 Landmarks — removed
The ideation conversation's "fixed cultural landmarks" concept (Live Nation, Coachella, Spotify as non-prospect anchor points within a cultural territory) is **not being built.** Reasoning, confirmed this session: too many companies work with a given landmark (e.g., Live Nation) for the relationship to be meaningful without knowing whether it's exclusive — and exclusivity isn't something that can be systematically sourced. Noisy, hard to keep current, low signal value relative to effort. Dropped from scope entirely.

### II.10 Open / pending decisions (Part II)
1. **Business verticals list — RESOLVED 2026-07-11.** Expanded from 6 to 9 wells: the original Food & Beverage, Automotive & Transportation, Technology & B2B, CPGs, Sports, Hospitality/Travel/Tourism, plus three new wells added this session — **Beauty/Retail** and **Media & Social Platforms** (needed to accommodate signal-sourced entities Ulta Beauty and Reddit, which didn't fit the original 6) and **Entertainment** (added per this section's own Liquid Death hybrid-brand example above — a flat single-category score for Liquid Death was inconsistent with the example the model was designed around). All 19 hub nodes scored 0–5 across all 9 wells by Claude first-pass draft, reviewed and corrected by the user. The single `vertical` field on each hub node has been removed and replaced with a `business_verticals` object in the seed JSON, mirroring `cultural_verticals`. Previously-empty CPGs and Sports wells now have partial coverage (Mojo Energy Pouches, PLL). **Not yet done:** this was a first pass built from category descriptions, not the deeper per-entity research the cultural pass received — real cross-vertical nuance (e.g., does Ram Trucks have meaningful retail/licensing crossover, does Subaru's dealer network touch Hospitality) is future work.
2. **Cultural verticals list — resolved, starting set (subject to revision):** Music (Performance), Sports, Gaming, Comedy, Festival, Talent & Celebrity Partnerships, Film/TV, Inclusion, College Marketing, Outdoor & Adventure, Inter-Brand Collaborations (unexpected brand mashups — e.g., Crocs × KFC), Creator & Influencer Partnerships, Wellness & Fitness. **13 wells total** (Film/TV and Inclusion confirmed as separate categories — see Part III, III.3). Explicitly expected to evolve — not a final taxonomy. Music's flagship-tactic status (should it get dedicated treatment ahead of the others, e.g. an "inbound to Music" view) remains an open follow-on question.
3. ~~Sister-agency ring color conflict~~ — **Resolved:** `#B83A1A` (G7 red), see II.3 and Part I 5a.1.
4. **Floor-state node glow treatment — RESOLVED/BUILT 2026-07-20.** Dim, low-opacity gray placeholder, confirmed live per this session's screenshot legend ("Floor state — dim placeholder (no client, no signal)").
5. **Drop-shadow reconciliation** — unresolved, flagged in II.3.
6. **Propagation schema re-expression** (6a.3's multipliers, now in gray-glow-opacity terms rather than purple fill) — unresolved, flagged in II.3.
7. **Elastic-tether temporary dragging** — worth building, or is pan/zoom alone sufficient? Not committed either way (II.5).
8. ~~G7 Gravity formula weights~~ — **MOOT 2026-07-20.** The composite score itself was replaced with an unscored "Notable factors" list — see II.7. No formula weights to tune since there's no formula.
9. **Arrow decay level shape** (linear vs. front/back-loaded) and **signal-type-dependent decay rates** — not yet decided (II.6).

### II.12 Build approach — v2 branch/rebuild (resolved this session)
Given the number of directly-superseded Part I build items (4b, 4c, 4f, 5a, 6a.1, 6a.1a, 6a.1b — see individual ⚠ flags), **this will be built as a v2 branch/rebuild** rather than incrementally patching the live build Claude Code has been iterating on. Branch name: **`cluster study v2`**. Rationale: several Part II mechanics (fixed positions replacing drag, weighted multi-vertical scoring replacing single-category assignment, concentric-centroid family rendering replacing fixed-radius orbits) are foundational enough that half-migrating them mid-session risks a broken intermediate state, especially with a Round 3 instruction set (selection-highlight-connectors, orbit-locked dragging, ring simplification, Generate Competitors) already in flight or recently completed on the current branch. The current build (`cluster-study` branch) remains the stable, demo-ready version (already shown to Julie) while `cluster study v2` is developed separately.

**Housekeeping (2026-07-20):** the standalone-export script still references the deleted `layout.js` and would crash if run — left broken-as-superseded since the project is going the hosted-page route instead. **Decision confirmed: leave as-is for now** — not worth spending time on given the hosted-page path is the actual direction. The stale "provisional stub scoring" panel note has been removed.

**Build status (2026-07-20, supersedes 2026-07-11 note):** dual-map positioning engine (II.1–II.2, II.4) built and working, now with the Option C sharpening-exponent fix live (`CULT_SCORE_GAMMA`). Color/glow system (II.3) and gravity-well isolation buttons (II.13) — built and live per the screenshot reviewed this session (white/gray/accent glow, sister-agency rings, 13-well isolation rail, "All/Experiential/Talent" and "Signals only/Dim competitors" filters all visible and functioning). Signal vectors (II.6) — built and verified live this session. **G7 Gravity (II.7) — built and verified live, then replaced same session** with the unscored "Notable factors" list; `gravity.js`'s composite/weighted scoring needs removal, not just an input fix. Well labels around the map edge — built this session (not separately speced before now, added directly to II.2), extended to the Business Landscape's 9 wells per II.15. **Not yet built:** ghost mode, the radar-chart detail panel, the visual cleanup pass (parent-node treatment, competitor cloaking, stronger Cultural-map selection dimming — all II.14/II.15, this session) — sequenced behind CAP producing real historical data where relevant, though bootstrap/FPO versions remain an option ahead of that. **Status still unconfirmed either way:** map-toggle fly animation between Business/Cultural positions, pan/zoom.

### II.11 Signal Sweep pipeline requirements (for the Signal Stacks thread)
Every signal Signal Stacks surfaces needs a new LLM classification pass, in addition to its existing lookalike relevance scoring, producing:
- **Cultural territory tags with confidence** — which cultural wells (once II.10's list is defined) this signal is evidence for, and how strongly.
- **Signal type** — identity-reinforcing (part of an established, repeated pattern) vs. momentum/one-off (a single new data point) — this is what determines whether something becomes a fading arrow (II.6) or actually nudges the underlying identity score.
- **Business vertical relevance**, where applicable (e.g., a product-line expansion) — kept separate from cultural tagging per II.1's explicit split, not blended into one score.
- **Arrow decay tier assignment** — which of the 6 monthly levels (II.6) a new signal starts at, and whether it reinforces an existing arrow or starts a fresh one.

**Not required (per II.9):** any landmark-detection extraction — that concept has been dropped, so no pipeline work is needed for it.

This is a genuinely new extraction category for Signal Stacks' existing Haiku pipeline, parallel to the already-flagged ownership-change extraction (Part I, 6a.5 / Flag 7) — worth scoping together as related pipeline additions rather than as isolated one-offs.

### II.13 Gravity-well isolation buttons (added 2026-07-11 — formalizes II.3's vertical-lens bullet)
One button per cultural well — 13 total, matching the `cultural_verticals` keys in the seed JSON (Music Performance, Sports, Gaming, Comedy, Festival, Talent & Celebrity Partnerships, College Marketing, Outdoor & Adventure, Inter-Brand Collaborations, Creator & Influencer Partnerships, Wellness & Fitness, Film/TV, Inclusion).

**Behavior:**
- Clicking a well button isolates it: every entity's glow shifts to the Cultural Landscape accent color (`#ffd22eff`), with **glow intensity/saturation scaled to that entity's stored score for the selected well specifically** — e.g. selecting Inclusion should make Ulta Beauty (`inclusion: 5`) glow brightly, Cayman Jack (`inclusion: 1`) barely glow at all, scaled proportionally in between.
- **Uses the stored score, not physical distance from the well's anchor.** These are two different things — a node's position reflects a weighted average across all 13 wells, so it can sit geometrically far from a well it still scores highly on. The lens must read the score field directly, not infer intensity from map position.
- Only one well isolated at a time. A second click on the same button (or a dedicated "clear" control) returns to the default glow state.
- **Cultural Landscape only for the first build pass.** Not building the equivalent for the Business Landscape's 9 wells in this round unless the same code path generalizes trivially — worth revisiting once the Cultural-side version is working and can be evaluated directly, rather than committing to double scope up front.

**Relationship to II.3:** this supersedes II.3's "vertical-lens illumination" bullet with a concrete UI mechanism (discrete buttons, single-select, explicit score-vs-distance rule) rather than a general description of the effect. **Role narrowed 2026-07-12** (see II.14): this lens is now understood as an ambient browsing aid on the Constellation map, not the primary tool for reading an entity's category strength — that job moved to the radar chart.

### II.14 Position-as-diagnostic reframe, ghost mode, and the entity detail panel (resolved 2026-07-12)
A real ambiguity was identified in the Constellation map's core value proposition: two entities can both score 5 on a category yet land in different positions, because one is pulled by additional wells the other isn't — this reads as "less committed" when it actually just means "also active elsewhere." Working through this produced a reframe that resolves it structurally rather than through a cleverer position formula:

**Position is a per-entity diagnostic, not a cross-entity ranking.** The Constellation map isn't meant to answer "which entity is more focused on Sports than that other entity" — each entity's position is read individually, typically triggered by that entity's own Signal Stacks activity, not scanned comparatively against neighbors. This directly extends Section 2's founding principle ("surface who else to talk to, not duplicate deal/status tracking") into the Cultural Landscape specifically.

**The Constellation map's real job, given this, is tracking movement over time — not precision.** Precision moved to two other surfaces:

- **Ghost mode (confirmed must-have).** A dim duplicate of an entity's previous position, connected to its current position by a thin fading line — shows net drift over a longer window (e.g., quarter-over-quarter), complementing the existing signal-vector arrows (II.6), which show very recent momentum. Arrows = "what just happened"; ghost trail = "where this has been heading." Not yet built — sequenced behind CAP producing real historical scores to trail against (score_history, per the CAP spec's data objects), though a hand-built version could demo the concept early using the same FPO-style bootstrap approach as Flag 9's Momentum layer.
- **Radar chart, in the entity detail (click-through) panel — not on the map.** One axis per cultural well (all 13, confirmed legible at that count against real Cisco data). **Edge style resolved 2026-07-20: spike burst, not a connected polygon.** Each category renders as an independent triangular spike from center to vertex, rather than straight or curved edges joining all 13 points into one continuous silhouette. This is where an entity's *exact* multi-category shape lives, with no risk of the position-vs-magnitude ambiguity that motivated this whole reframe, since each axis is independent and unblended — the spike-burst treatment reinforces that independence visually too, since nothing connects one category's spike to its neighbor's the way a polygon edge would.

**Detail panel structure:** radar chart at the top, an expandable accordion below it — one row per cultural category (name + current score), expanding to reveal that category's rubric sub-factor breakdown (Historical Depth, Recurrence, Strategic Importance, Recent Momentum, Breadth of Activity — per Cultural Affinity Processor spec §3). **Currently these rows show an honest "pending" state** rather than fabricated numbers, since the seed data is still a single flat integer per category — this is exactly what Part III's real pipeline is meant to populate. Not yet built.

**Downstream effect on II.13:** the gravity-well isolation buttons are demoted from primary analytical tool to an ambient Constellation-map browsing aid — useful for "what's glowing on Inclusion right now" at a glance, while the radar chart becomes the authoritative per-entity readout once a user has clicked in.

**Also worth logging:** once CAP's rubric factors are real (rather than "pending"), an entity's *composite* category score will naturally be less prone to exact ties than today's single hand-entered integer — five independently-scored sub-dimensions rolling up into one number are far less likely to land on the same value as another entity's by coincidence than a single FPO-entered 0–5 score is. This is a secondary, welcome side effect of CAP existing, not something to build separately — no sub-well taxonomy expansion needed (explicitly rejected as unnecessary complexity).

### II.15 Visual cleanup pass — parent-node treatment, competitor visibility, selection dimming, Business Landscape labels (resolved 2026-07-20, from live-build screenshot review)

Prompted by a direct review of the live build ahead of the broader team showing. Four distinct issues, all fixable without touching the underlying data model.

**Parent-node color treatment — real gap identified, now resolved.** Parent entities (Mark Anthony Brands, Intuit, Swisher, JHMR) were never given an explicit fill/glow rule — only a larger-radius sizing rule existed (Part I, 6a.1). In practice this reads as "sort of exists, sort of doesn't" (an outline with no real fill). **Resolved: parents are not a separate visual category.** They follow the exact same three-state rule as any other node (white / gray-signaled / floor-dim, §II.3) — just evaluated by aggregating their children's status rather than having a status of their own, at the already-speced larger radius. A parent glows white if it has at least one `is_g7_client: true` child (Mark Anthony Brands, Swisher, JHMR all qualify); a parent with no current-client children falls back to gray-signaled or floor-dim on the same basis as any other node. **Concretely, this means Intuit — whose only child, TurboTax, is `is_g7_client: false` (lapsed relationship, per its own `g7_notes`) — should render as a non-white parent node**, which is correct behavior given the data, not a bug to fix.

**Worth a direct read on this: is the TurboTax/Atlassian comparison actually an inconsistency, or is it correctly reflecting real data?** Checked directly against the seed JSON: Atlassian is `is_g7_client: true`; TurboTax/Intuit is `is_g7_client: false`, explicitly noted as a lapsed relationship ("last worked together roughly a year ago, not a current client"). If TurboTax is rendering differently from Atlassian, that's the intended distinction, not a color-scheme bug — the two are genuinely in different states. Worth confirming this reads clearly enough visually rather than assuming it needs fixing; if the *lapsed* state deserves its own explicit visual treatment (distinct from a competitor that was never a client at all), that's a real fourth category worth naming on purpose rather than leaving implicit — flagged as an open question below.

**Competitor/adjacent node visibility — split by map.** Competitor and adjacent-brand entries (the `adjacent` array on each hub node) have no `cultural_verticals` or `business_verticals` scores of their own — they were never meant to receive a real gravity-well position under the Map Engine v2 model (Part II, II.1–II.2), only the 19 scored hub nodes were. On the Cultural Landscape specifically, their current force-directed hub-and-spoke placement (inherited from the original Part I network-diagram concept) sits awkwardly among real gravity-well positions and implies a cultural affinity reading that doesn't exist for them. **Resolved: cloak competitor/adjacent nodes entirely on the Cultural Landscape** — this map shows only the 19 scored entities with real positions, full stop, consistent with II.14's principle that position should never imply data that isn't there. **Keep them visible on the Business Landscape**, where the original hub-and-spoke relationship view (direct competitor / analogous audience, connected by edges to their hub) remains a genuinely useful, honest visualization in its own right — it was never claiming to be a scored gravity position there, just a relationship map, which is a legitimate and different kind of information from what the Cultural Landscape is doing.

**Selection dimming — much stronger on the Cultural Landscape specifically.** The existing rule (§4h: selecting a node dims everything else "slightly") is too weak for what the Cultural Landscape needs, now that II.14 has established position there as a per-entity diagnostic rather than a comparative view. **Resolved: on the Cultural Landscape, selecting an entity should dim all non-connected, non-selected nodes and edges far more aggressively** — near-invisible, not just muted — so the selected entity's position within the gravity field reads in near-total isolation. The Business Landscape can keep the original, lighter dimming behavior, since relationship-context legibility (seeing a selected node's neighbors) is still useful there.

**Business Landscape well labels — extend the pattern already built.** The 13 cultural-well cartographic labels (built this session, §II.2) worked well enough to be worth their own review — extend the same treatment to the Business Landscape's 9 business wells (Food & Beverage, Automotive & Transportation, Technology B2B, CPGs, Sports, Hospitality/Travel/Tourism, Beauty/Retail, Media & Social Platforms, Entertainment), same visual language (faint labels at true bearing, fitted into the default view, fading out when the other map is active).

**RESOLVED 2026-07-20 — no new visual state.** `is_g7_client` is redefined to mean "G7 has a real, evidenced relationship with this entity" (current or lapsed), not "actively working together this quarter." Reasoning: a maintained current/lapsed distinction requires ongoing manual upkeep the tool has already committed to avoiding (Section 2, principle 6), and — more importantly — the tool's actual value is Signal-triggered, where a lapsed relationship with real history is functionally just as actionable as a current one (arguably warmer than a cold competitor with a signal). TurboTax/Intuit flipped to `is_g7_client: true` under this redefinition; the lapsed status itself remains documented in `g7_notes` as text, not promoted to a competing color channel.

## PART III: Cultural Affinity Processor — the Signals↔Clusters bridge (added this session)

Full spec: `G7_Cultural_Affinity_Processor_Spec.md` (companion doc — preserved in full there rather than duplicated here). This section covers cross-references and reconciliation with earlier Part II decisions only.

### III.1 What this is
A distinct middleware layer between Signal Stacks and Cluster Study — not a Cluster feature and not a Signal Stacks feature, but its own subdevelopment. Signals discovers raw activity; the Cultural Affinity Processor classifies it against the Culture Space taxonomy and turns it into two persistent scores per entity per category (**Established Affinity** — stable, historical — and **Recent Momentum** — time-sensitive, current); Clusters only renders the processed output.

### III.2 This supersedes Part II's simpler mechanics — needs your confirmation
This spec is considerably more mature than what Part II sketched earlier this session, and appears to replace rather than sit alongside it:
- **II.6's flat 4-week/6-level arrow decay schedule** is superseded by this spec's evidence-threshold model — momentum updates continuously and stable-affinity only recalculates when repeated signals accumulate, a long-term platform is announced, or a category reaches a configured evidence threshold (Section 6 of the spec). More sophisticated, category-aware, and explicitly avoids the "one announcement overcorrects the score" problem the same way, just with a stronger mechanism.
- **II.8/II.11's brief "add a classification layer to the Haiku pipeline" note** is now the full 12-section spec — Section III.11 below replaces those flags' scope entirely.
- ~~**II.7's G7 Gravity** remains conceptually the same, but now has real inputs to draw from~~ — **MOOT 2026-07-20.** II.7's composite score was replaced with an unscored "Notable factors" list (see II.7) — there's no longer a composite score for CAP's output to feed into on the Cluster Study side. **Same principle likely applies to CAP itself:** this spec's own §8 still names "G7 Gravity" as something CAP should feed — worth revisiting there too before it gets built, rather than reintroducing the same composite-score problem one layer down. Flagged for the CAP thread, not resolved here.

**Not superseded:** II.1–II.5 (data model, dual-map positioning, color/glow model, family/orbit rendering, dragging policy) are unaffected — this processor feeds the *scores*, not the rendering mechanics.

### III.3 Film/TV vs. Inclusion — resolved this session
**Split confirmed, not merged.** Film/TV refers specifically to how much a brand invests in TV/movie spots, product placement, and screen presence. Inclusion is a separate DEI-focused category (authenticity, LGBTQ+, disability, gender equity commitments) — genuinely useful on its own for talent and strategy decisions, not a subset of Film/TV. **Culture Space now has 13 wells, not 12.**

**Data consequence:** the existing 14 entities' merged `film_tv_inclusion` scores were split in the JSON — preserved as `film_tv` (the old value), with a new `inclusion` field set to **null**. A single merged number doesn't reveal how much of it was screen presence versus DEI commitment, so **all 18 entities (14 existing + 4 new) need a fresh, separate Inclusion score** — this is real follow-up scoring work, not a data-migration formality.

### III.4 Real data now exists
The user has produced an FPO (for-placement-only) scoring pass across the cultural verticals for 14 existing hub nodes, now merged into `G7_Cluster_Study_Seed_Data.json` as each node's `cultural_verticals` object. Four new signal-sourced entities surfaced through this pass and were added as new hub nodes (non-client, `confidence: "signal_sourced"`): **Ulta Beauty, Reddit, Stella Artois, Professional Lacrosse League (PLL).**

**Resolved this session:**
- **Ulta Beauty's parent field** — the "Ultra" note was a user typo, not a real relationship. Corrected; Ulta Beauty is a standalone cosmetics retailer with no connection to Mojo Energy's competitor of a similar name.
- **Jackson Hole Mountain Resort restructured** — JHMR is the parent/hosting resort; **Rendezvous Music Festival is the actual G7 client program** and is now the scored hub node (id renamed from `jackson_hole` to `rendezvous_music_festival`). JHMR itself is added as a new `corporate_parents` entry, same pattern as Mark Anthony Brands/Intuit/Swisher.

**RESOLVED 2026-07-11:** spot-checked directly against the source FPO sheet screenshots. Row order matched exactly across both images and against the seed JSON, with no drift — including the two adjacent "Signal" rows (Olé Cocktails, Ulta Beauty) that were the most plausible place for a silent misalignment.

**Note:** `business_verticals` (Part II, II.1) — **now also has real data**, as of 2026-07-11 (see Part II, II.10 open question #1, resolved). All 19 hub nodes scored across the now-9-well taxonomy, first-pass draft reviewed and corrected by the user. Still a lighter-touch pass than the cultural scoring — no dedicated per-entity research, just category-description-driven scoring — so treat as a solid first cut rather than final.

**Important framing, added 2026-07-11:** every score currently in `cultural_verticals` and `business_verticals` is a manual placeholder for the Cultural Affinity Processor's **Established Affinity** value only (spec Sec. 7) — a single blended number standing in for what the real rubric (Historical Depth, Recurrence, Strategic Importance, Recent Momentum, Breadth, rolled into a computed 0–100 value) will eventually produce. There is no **Recent Momentum** layer yet at all, since that requires a live Signal Stacks feed the processor doesn't have. This isn't a defect in today's data — it's the expected bootstrap state — but it means these numbers should be expected to shift once the real rubric pipeline exists, and any "low affinity, high momentum" type analysis (the spec's most distinctive use case, Sec. 7) isn't yet possible from this data. See Flag 9 (Section 12) for the planned FPO Momentum layer to demo this duality ahead of the real pipeline.

## 7. Data dependencies (the real blocker)

1. **Per-client curated adjacent/competitor brand lists** — real research needed; general-knowledge mockups (as done for Bandai Namco) won't scale to less-obvious clients. **In progress** — see Section 11.
2. **Revenue/project-volume figures per client/category** — blocks the Leadership view entirely; not sourced yet
3. **Project Worldwide sister-agency client list** — blocks the sister-agency connection-distance layer (Section 6a); user is checking on availability of a historical account
4. **RFP tracker data mapping** — tracker already exists and logs won/lost status; still needs schema mapping into the scoring pipeline (Section 6)
5. **Parent/subsidiary corporate structure mapping** — new as of Section 6a; needed to populate `parent_of` edges

## 8. Platform recommendation

- **Primary:** D3.js, hosted free on GitHub Pages, reading live from the same Google Sheet Signal Stacks already uses. Purpose-built for weighted, animated, filterable network diagrams — force-directed layouts, smooth color/position transitions, and toggleable filters are all native.
- **Alternative considered:** Streamlit (Python) — rejected primarily due to free-tier cold-start delay for an occasionally-used internal tool.
- User is unfamiliar with D3; Claude would write the code directly. Not a barrier to the recommendation.
- Ring rendering, lens-based opacity toggling, convex-hull grouping (Section 6a), and the visual grammar above are all standard D3 patterns — confirmed buildable, not theoretical.
- **Setup note:** no registration or application download required. D3 loads via CDN `<script>` tag into a self-contained HTML file, consistent with the Scout build pattern. A code editor (e.g., VS Code) and a GitHub account/repo (for GitHub Pages) are the only real prerequisites. Claude Code is the recommended build environment — it can create files directly in the repo, run a local preview server, iterate on the force-layout tuning in a tight loop, and handle git commit/push and GitHub Pages deployment end to end, none of which this chat interface can do.

## 9. Open design questions

1. ~~When a new signal scores similarly to two existing clients~~ — **Resolved:** connects to both.
2. ~~Should connection strength be visible~~ — **Resolved:** connected/not-connected is enough for now; no line-thickness encoding.
3. ~~What defines "recency" across clients/prospects/RFPs~~ — **Resolved, scaled back:** for now, just identify clients — don't try to encode differentiated recency clocks per type. Differentiated recency (if needed) is a phase 2 addition, not part of the initial build.
4. ~~If a decayed node gets re-flagged later~~ — **Resolved:** snaps back to full purple immediately, no gradual ease-in.
5. On click, what's the single most useful thing a node should surface — resolved for the Talent side (Section 10.4). Still open for the Experiential/client side.
6. ~~Do people need direct search/jump-to-client~~ — **Resolved:** yes, search is wanted alongside browsing.
7. ~~Tier 1 only, or every plausible brand~~ — **Resolved:** build out hubs wherever relevant, not limited to the original Tier 1 list. (Already happening in practice — see Mike's Hard Lemonade, Cayman Jack, Olé, Mojo Energy, all added this session.)
8. ~~Is "current client" visually distinct from "past client"?~~ — **Descoped**, see Section 2 principle 6 and Section 5. **Reconfirmed and formally resolved 2026-07-20** with the same conclusion via a different route (Signal-relevance framing) — see II.15.
9. ~~Ring stacking~~ — **Resolved, simplified this session:** collapsed to **two ring types** — a unified **Signal ring** (teal; covers both Signal Stacks detection and RFP-sourced events, since Section 6 already treats RFP outcomes as a scoring input rather than a distinct displayed category) and a **Sister-agency ring** (yellow; see 5a.1). The previously separate "RFP-sourced opportunity" ring has been removed as its own category — an RFP event still darkens fill and activates the same generic Signal ring, it just no longer gets a visually distinct ring color of its own. This substantially eases the ring-density concern from earlier in this section.
10. ~~Floor color choice~~ — **Resolved, see Section 5.**
11. ~~Animation~~ — **Resolved, revised this session:** replaced the separate "new addition" ring with a **pulsing glow** instead — the node's existing glow (5c) renders brighter and pulses slowly for its first week, rather than adding a fourth concurrent ring type. This further eases ring density (down to two ring types now, per #9) while still giving new additions a distinct "just landed" signal, and it fits the stellar-cartography aesthetic (5c) more naturally than a ring ever did.
12. Decay parameters: half-life for the recency decay function — still needs tuning against real data, not decided in the abstract.
13. Does the hop-capped propagation multiplier (6a.3) combine with ring stacking (#9) in any special way — e.g., does a proximity-signal node ever get its own ring, or is a ring reserved for direct (non-inherited) signals only? Still open, though now a two-ring-type question (Signal, Sister-agency) rather than a three-type one, per #9's simplification.
14. ~~COI-sensitive competitors~~ — **Originally resolved as "no visual treatment needed, stays a data-layer flag." Superseded 2026-07-20: removed entirely, including the data-layer flag.** A brand-level `coi_sensitive` marker can't accurately represent reality when a brand spans multiple product lines, only some of which genuinely conflict with a client relationship — a wrong flag in either direction is worse than no flag, and NBD's own judgment already covers this nuance better than a blanket marker could. `coi_sensitive`/`coi_note` removed from all adjacent entries in the seed JSON. Distinct from Section 10.3/10.4's talent-partnership-overlap COI concept, which is a specific, verifiable fact (same artist, overlapping partnership windows, two competing brands) rather than a holistic entity-level judgment — that one is unaffected.

**Ring rendering — resolved via zoom-conditional detail (added this session), simplified further this session (see #9, #11).** With the RFP-sourced ring removed and new-addition moved to a glow-pulse rather than a ring, the density concern is largely resolved structurally rather than needing to lean entirely on zoom — at most two ring types (Signal, Sister-agency) can now coexist on one node, a much easier case than the original four-state concern. Zoom-conditional detail remains useful for the rare case of both ring types plus a pulsing glow coinciding, and for enabling ring text labels at close range if ever needed:
- **At default zoom:** rings stay simple — color/style only.
- **Past a zoom threshold:** rings separate further from magnification, and small text labels become viable if needed.
- A prototype (built earlier this session with the Visualizer) confirmed the color-only default reads fine; real code will validate the simplified two-ring version directly.

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
- ~~**New concept — COI-sensitive competitors.**~~ **REMOVED 2026-07-20 — see Section 9, open question 14.** Was: raised directly by the user for a client as significant as Mark Anthony Brands, implemented as a `coi_sensitive` flag + note on relevant `adjacent` entries. Dropped as too complex to accurately represent at the entity level — many brands span product lines where only some conflict, and a wrong flag is worse than no flag.
- ~~**New relationship type — structurally analogous clients.**~~ **REMOVED 2026-07-20** — see 6a.7. Was: a third pattern distinct from `direct_competitor` and `analogous_audience`, tracked at the `corporate_parents` level via a `structural_analogs` field (e.g., Mark Anthony Brands ↔ Swisher). Dropped as too subjective for a relationship type displayed as fact.
- **New finding — a real RFP-lost example.** Subaru includes a genuine instance of the RFP-as-scoring-input mechanism (Section 6): G7 pitched Subaru for Talent Booking business and didn't close it. This is a real, ready-to-use test case for the lookalike-search pipeline once Gate 2 is reached, rather than needing a hypothetical like the Ultraman example.
- **Gate 2:** RFP-triggered lookalike pipeline (Section 6) scoped and tested against a handful of real past RFPs.
- **Gate 2a (new):** Parent/subsidiary mapping (Section 6a) scoped — a smaller, more contained research task than Gate 1's full competitor/analog research, since it only needs ownership relationships, not full competitive landscapes.
- **Gate 3:** Open questions in Section 9 resolved — several already closed this session (floor color, current/past client status, layout mechanism); remainder are cheap now, expensive to retrofit after nodes are live.
- **Gate 4:** Build, recommended in Claude Code (Section 8) once Gates 0–3 are sufficiently clear. **Underway** — first live build complete (screenshot reviewed this session showing the Mark Anthony Brands cluster, ring rendering, and floor-gray nodes working). Rough estimate for remaining work: 10–16 hours for remaining core D3 mechanics + 4–7 hours for draggable nodes with return-to-home (Section 4b) + 8–12 hours for the RFP lookalike pipeline + additional time, not yet estimated, for the parent/subsidiary propagation logic (Section 6a.3–6a.6). **Round 2 refinements:** 2–3 hrs (snap-to-grid drag, 4c) + 3–5 hrs (label/collision avoidance, 4d) + 1–2 hrs (client identity marker, 5a) + 4–6 hrs (orbital layout + larger parent nodes, 6a.1) + 2–3 hrs (orbit exclusion zone, 6a.1a) + 1 hr (cluster spacing tuning, 4e) + 1 hr (drop shadows, 5b) ≈ 14–21 hours. **Round 3 refinements from live-build feedback, this session:** ~1 hr (selection highlights all connectors, 4h) + ~2 hrs (orbit-locked child dragging, 6a.1b) + ~1 hr (pulsing glow for new additions, replacing the ring, 9/11) + ~1 hr (ring simplification — net time saved, not added) + 6–10 hrs (Generate Competitors on-demand search + Cloudflare Worker proxy, 6c) ≈ **11–15 additional hours,** the bulk of it being the new Generate Competitors feature.
- **Gate 5:** Launch NBD view first; Leadership view once revenue data exists.

**Bootstrap rationale:** since Signal Stacks will take time to build up steam, Cluster's node population doesn't need to wait for it — the manual case-study/AI-assisted lane (one of the three original data-entry paths) can run independently now. These become permanent floor-state nodes (Section 5) with no ring or relevance decay; Signal Stacks later lights up rings/fill on top of the same brands as live signals arrive, rather than creating the nodes from scratch.

**Map Engine v2 (Part II) status:** this is a foundational architecture change, not an incremental addition to the Gate structure above — several completed or in-progress Round 2/3 build items are directly superseded (flagged individually at each affected subsection). Not yet costed in hours, since core open questions (the cultural vertical taxonomy, several color/rendering reconciliations) are still unresolved per Part II, II.10. Recommend treating this as its own phase, sequenced after the open questions in II.10 are resolved, rather than folding it into the existing Gate 4 estimate until scope is firmer.

---

## 12. Flags for the Signal Stacks thread

These items surfaced in Cluster planning but are implementation work that belongs in the Signal Stacks build, not here:

1. **Sister-agency "warm path" signal** (Project Worldwide relationships) was already noted in the master plan as a candidate third anchor signal for Signal Stacks' core scoring rubric. As of this session, this is now understood as one instance of the general **connection-distance mechanism** (Section 6a) shared with parent/subsidiary corporate structure — worth designing the propagation logic (three-step schema, two-hop cap) once, and applying it to both sister-agency and corporate-structure edges, rather than building two separate mechanisms. **Partially unblocked:** two real examples now confirmed directly (Subaru, Lagunitas — see Section 5a.1), enough to make the sister-agency ring demonstrable. The full Project Worldwide client list is still unsourced.
2. **RFP tracker as a Signal Stacks input source.** Section 6 treats the RFP tracker as a Cluster scoring input, but there's a reasonable argument it should also feed Signal Stacks' own lookalike scoring directly. Worth deciding in the Signal Stacks thread whether this is one ingestion pipeline feeding both systems, or two separate integrations.
3. **Lookalike scoring stability is a hard prerequisite for Cluster**, per Gate 0. Any changes to the lookalike scoring rubric after Cluster is built will require rework on the Cluster side. Worth flagging that the rubric should be considered close to stable before Cluster building starts in earnest.
4. **Outcome tracking column** (open risk #2 in the master plan — `contacted/pitched/won/ignored`) becomes more valuable once Cluster exists, since it could double as an input to Cluster's relevance/signal-strength scoring, not just Signal Stacks ROI assessment.
5. **Talent Booking schema needs two additions once the rubric is built** (Section 10): a structured `talent_name` field, and a way to distinguish **booking type** — one-off engagement vs. ongoing/exclusive partnership. Both are needed for Cluster's Talent-side refinements, but they're schema decisions that belong in the Talent Booking rubric design, not retrofitted after the fact.
6. **Scout vocabulary enrichment (ancillary, low priority).** Once the `talent_name` field exists, a simple scheduled (cron-pull, not real-time) diff could feed newly-identified artist names from the Backbone Sheet into Scout's entity vocabulary. No urgency; worth doing once Scout and Signal Stacks are both stable, not before. Depends on knowing how Scout's vocabulary is currently stored — not yet confirmed.
7. **New — ownership-change extraction.** Section 6a.5 proposes adding an ownership-change extraction category (acquirer, acquired entity, date) to the existing RSS/Haiku pipeline, with a human-approval gate before it mutates Cluster's parent/child graph. Worth scoping alongside the existing extraction categories rather than as a fully separate pipeline.
8. **Superseded/expanded — Map Engine v2 classification layer.** What was a brief flag here is now the full **Cultural Affinity Processor** spec — see Part III and the companion doc `G7_Cultural_Affinity_Processor_Spec.md`. This is a distinct middleware subdevelopment between Signals and Clusters, not a small addition to the existing Haiku pipeline — worth scoping as its own initiative rather than folding into Flag 7's ownership-change extraction.
9. **New (2026-07-11) — FPO Momentum layer needed for team presentation.** The `cultural_verticals`/`business_verticals` scores currently in the seed JSON are single blended numbers standing in for the spec's **Established Affinity** value only (Cultural Affinity Processor spec, Sec. 7) — there is no Recent Momentum data yet, since that requires a live Signal Stacks feed the processor doesn't have. For the team presentation (~one month out, per memory), a hand-built **FPO Momentum Historical Value** pass across existing entities would give a concrete graphic example of the affinity/momentum duality (e.g., the "low affinity, high momentum" case the spec calls out in Sec. 7 as especially useful) without needing the real pipeline built first. **Not started — on the todo list**, sequenced behind Signal Stacks/processor work but useful to mock up earlier for demo purposes.

---

*Companion doc: `G7_Signal_Stacks_and_Cluster_Study_Master_Plan.md` (Signal Stacks detail, Part 1) and `G7_Verticals_Lookalike_Analysis_DRAFT.md` (Tier 1 client/vertical analysis referenced in scoring). Data artifacts: `G7_Cluster_Study_Seed_Dataset.md` and `G7_Cluster_Study_Seed_Data.json`.*
