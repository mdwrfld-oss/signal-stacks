/**
 * G7 Cluster Study — NBD hub-and-spoke view.
 *
 * Layout model (Plan Section II.2/II.5): positions are fixed, computed
 * entirely from each entity's weighted vertical scores — no dragging.
 * Pan/zoom (Section 4a) is the only camera interaction. Lens switching
 * changes visibility treatment only — dim/desaturate, never reposition — so
 * spatial memory holds.
 *
 * Visual grammar (II.3): white glow = G7 client (evidenced relationship);
 * gray glow fading with age = live signal; dim = floor state. Corporate
 * families render as concentric rings (II.4). Ghost mode (II.14) draws a
 * dim duplicate at a node's previous-snapshot position when history exists.
 *
 * ?demo=1 injects synthetic signals client-side for tuning the grammar and
 * propagation before real Signal Stacks data exists. Demo data never touches
 * the server.
 */

import {
  DEFAULT_CONFIG,
  computeEffectiveRelevance,
  ringsFor,
  isNewAddition,
  arrowDecayLevel,
} from './scoring.js';
import {
  BUSINESS_VERTICALS,
  CULTURAL_VERTICALS,
  normalizeScores,
  weightedPosition,
  centroid,
  LEGACY_SECTOR_TO_BUSINESS,
} from './verticals.js';

const svg = d3.select('#canvas');
const statusEl = document.getElementById('status');
const panel = document.getElementById('detail-panel');
const panelContent = document.getElementById('panel-content');

const SETTLE_TICKS = 300;
const ANCHOR_STRENGTH = 0.22;
const RING_LABEL_ZOOM = 2.2; // rings separate + labels become viable past here
const ADJ_LABEL_ZOOM = 0.85;

// §6a.1: parents render visibly larger than hubs — they're organizing
// structure, not peer nodes.
const RADII = { hub: 16, parent: 24, adjacent: 8 };
const RING_GAP = 4;

/*
 * Map Engine v2 (Plan Part II): position is SEMANTIC. Each map's vertical
 * wells are fixed, INVISIBLE anchor points (attractors, not labeled regions —
 * II.2); a scored entity sits at the weighted average of the anchors its
 * scores pull it toward. Two independently-computed coordinates per node —
 * Business Landscape and Cultural Landscape — with a toggle that flies every
 * node between them. This replaces Part I §4f's sector grid/force entirely.
 */
const MAP_TRANSITION_MS = 1100;
// Cluster breathing room (spacing pass): since scored hubs/parents are PINNED
// to their anchor-weighted positions, the distance BETWEEN clusters is set by
// the anchor geometry, not by repulsion — node/label sizes are fixed, so
// scaling the wells apart (then letting fit-to-view re-normalize) is what buys
// real whitespace between families and standalone hubs. Bumped ~20% this pass.
// Business wells: 3×3 grid of anchor points (9 verticals).
const BIZ_COL_STEP = 800;
const BIZ_ROW_STEP = 680;
// Cultural wells: 13 anchor points on an ellipse.
const CULT_RX = 990;
const CULT_RY = 700;
// Cultural spacing: raw proportional weights collapse everyone toward the
// ellipse centroid (every entity carries some score in most of the 13 wells).
// Sharpening the weights (score^gamma before normalizing) makes a 5 pull
// disproportionately harder than a 3, so small score differences become
// visually distinct positions. Presentation-only — panel still shows raw 0–5.
// Tuned by measurement: gamma 1 packed every entity within 24% of the well
// radius (mean pairwise 135px); 2.6 spreads to 70% reach / 299px mean while
// staying inside the label ring (0.8). gamma 3 collides with the labels.
const CULT_SCORE_GAMMA = 2.6;
// Well labels render at this fraction of the anchor radius — same bearing as
// the true (invisible) anchor, pulled inward so the fitted view stays tight.
const WELL_LABEL_RADIUS = 0.8;
// II.6 signal vectors: arrow length steps down per 4-week decay level (0–5).
const VECTOR_BASE_LEN = 92;
const VECTOR_LEN_STEP = 12;

const state = {
  graph: null,
  config: DEFAULT_CONFIG,
  lens: 'all',
  signalsOnly: false, // §4g
  dimCompetitors: false, // §4g
  map: 'business', // II.2: active landscape
  isolatedWell: null, // II.3: active cultural gravity-well isolation
  selected: null,
  k: 1,
  effective: new Map(),
  nodesById: new Map(),
  neighborHubs: new Map(), // adjacent/parent id -> Set(hub ids) for lens membership
};

/* II.3 color model: the purple fill gradient is gone. Base state — clients
 * glow white, signaled non-clients glow gray fading with signal age, floor
 * nodes are dim placeholders (open design question; deliberately unpolished).
 * The map's identity color lives ONLY in interaction feedback (--map-accent:
 * business purple / cultural yellow) and well isolation. */
const MAP_ACCENT = { business: '#9a6cd3', cultural: '#ffd22e' };
const isolationFill = d3.interpolateRgb('#211e15', '#ffd22e');

// §5c idle drift (resolves open question 4b in favor of "yes, drift"):
// stars drift gently at rest. Purely visual — the offset is applied to the
// rendered transform only, never to simulation coordinates, so layout,
// snapping, and hit-testing are untouched. Set amplitude 0 to disable.
const DRIFT_AMPLITUDE = 1.6;
const DRIFT_SPEED = 0.00045;

init().catch((err) => {
  statusEl.textContent = `Failed to load: ${err.message}`;
});

async function init() {
  const resp = await fetch('./data.json');
  if (!resp.ok) throw new Error(`/data returned ${resp.status}`);
  const graph = await resp.json();
  state.graph = graph;
  state.config = { ...DEFAULT_CONFIG, ...(graph.config || {}) };

  if (new URLSearchParams(location.search).has('demo')) {
    injectDemoSignals(graph);
    document.getElementById('source-badge').textContent = `${graph.source} + demo signals`;
  } else {
    document.getElementById('source-badge').textContent = `data: ${graph.source}`;
  }

  prepare(graph);
  render(graph);
  statusEl.classList.add('hidden');
}

/* ------------------------------------------------------------------ data */

function prepare(graph) {
  const now = Date.now();
  state.effective = computeEffectiveRelevance(graph.nodes, graph.links, now, state.config);
  state.nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  // Label metrics via canvas so collision boxes exist before the settle runs
  // (DOM text can't be measured yet, and hidden labels measure as 0).
  const measureCtx = document.createElement('canvas').getContext('2d');
  const FONT_STACK =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  graph.nodes.forEach((n, i) => {
    n.driftPhase = i * 2.399963; // golden-angle spread so stars don't sync
  });
  for (const n of graph.nodes) {
    n.r = RADII[n.type] || RADII.adjacent;
    n.rings = ringsFor(n);
    n.isNew = isNewAddition(n, now, state.config);
    const eff = state.effective.get(n.id);
    n.relevance = eff ? eff.relevance : 0;
    n.floor = !n.signal && !eff;

    // §4d collision box: node circle + ring stack + label, as one AABB.
    // Text is wider than the circle it hangs from, so the box is label-driven.
    // Fonts mirror the §5d hierarchy in style.css.
    measureCtx.font = n.type === 'adjacent' ? `7.5px ${FONT_STACK}` : `600 12px ${FONT_STACK}`;
    n.labelW = measureCtx.measureText(n.name).width;
    const ringExtent = n.r + RING_GAP * n.rings.length;
    const labelBottom = ringExtent + 12 + 4; // label baseline (+12) plus descent
    n.boxHw = Math.max(ringExtent, n.labelW / 2) + 4;
    n.boxHh = (ringExtent + labelBottom) / 2 + 2;
    n.boxCy = (labelBottom - ringExtent) / 2; // box center sits below node center
  }

  // Step 3: parent glow state is AGGREGATED from its children — parents have
  // no signal/relationship of their own. Every node gets a resolved
  // {glowClient, glowRelevance, glowFloor} triple; applyGlow() reads it so the
  // three-state rule (white / gray-signaled / floor-dim) is uniform. A parent
  // glows white if ANY child is a G7 client; else gray at its brightest
  // child's relevance; else floor-dim.
  const childrenOf = new Map();
  for (const n of graph.nodes) {
    if (!n.parent) continue;
    if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []);
    childrenOf.get(n.parent).push(n);
  }
  for (const n of graph.nodes) {
    if (n.type === 'parent') {
      const kids = childrenOf.get(n.id) || [];
      const client = kids.some((c) => c.is_g7_client);
      const relevance = kids.reduce((m, c) => Math.max(m, c.relevance || 0), 0);
      n.glowClient = client;
      n.glowRelevance = relevance;
      n.glowFloor = !client && relevance === 0;
    } else {
      n.glowClient = n.is_g7_client;
      n.glowRelevance = n.relevance;
      n.glowFloor = n.floor;
    }
  }

  // Lens membership for nodes without their own zone: an adjacent brand or a
  // corporate parent is "in" a lens if any hub it touches is (combo counts in
  // both — Section 4).
  state.neighborHubs = new Map();
  for (const l of graph.links) {
    const s = state.nodesById.get(linkId(l.source));
    const t = state.nodesById.get(linkId(l.target));
    if (!s || !t) continue;
    for (const [a, b] of [[s, t], [t, s]]) {
      if (b.type === 'hub') {
        if (!state.neighborHubs.has(a.id)) state.neighborHubs.set(a.id, new Set());
        state.neighborHubs.get(a.id).add(b.id);
      }
    }
  }

  // II.1 normalized weights per map. Scored hubs use their two profiles;
  // v1 CSV/generated nodes carry only a legacy `sector` — mapped to a
  // single business-vertical weight so they place on the Business map
  // (no cultural data → they don't fly on toggle, see render()).
  for (const n of graph.nodes) {
    let business = normalizeScores(n.business_verticals, BUSINESS_VERTICALS);
    if (!business && n.sector && LEGACY_SECTOR_TO_BUSINESS[n.sector]) {
      business = { [LEGACY_SECTOR_TO_BUSINESS[n.sector]]: 1 };
    }
    n.weights = {
      business,
      // Gamma-sharpened for spacing (see CULT_SCORE_GAMMA) — dominant wells
      // dominate position, so near-tied profiles stop stacking at the center.
      cultural: normalizeScores(n.cultural_verticals, CULTURAL_VERTICALS, CULT_SCORE_GAMMA),
    };
  }
}

const linkId = (v) => (typeof v === 'object' ? v.id : v);

function inLens(node, lens) {
  if (lens === 'all') return true;
  if (node.zone) return node.zone === lens || node.zone === 'combo';
  const hubs = state.neighborHubs.get(node.id);
  if (!hubs) return false;
  for (const hubId of hubs) {
    const hub = state.nodesById.get(hubId);
    if (hub && (hub.zone === lens || hub.zone === 'combo')) return true;
  }
  return false;
}

function injectDemoSignals(graph) {
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().split('T')[0];
  // cultural_wells drive II.6 arrows — dates staggered so demo mode shows
  // several decay levels at once (5d → level 0, 70d → level 2, 150d → level 5).
  const demo = {
    white_claw: { strength: 0.95, date: daysAgo(5), type: 'signal_stacks', cultural_wells: ['music_performance'] },
    mikes_hard_lemonade: { strength: 0.9, date: daysAgo(2), type: 'signal_stacks', cultural_wells: ['festival'] },
    subaru: { strength: 0.85, date: daysAgo(20), type: 'rfp', cultural_wells: ['outdoor_adventure'] },
    liquid_death: { strength: 0.6, date: daysAgo(70), type: 'signal_stacks', cultural_wells: ['comedy', 'gaming'] },
    workday: { strength: 0.5, date: daysAgo(150), type: 'signal_stacks', cultural_wells: ['sports'] },
  };
  for (const n of graph.nodes) {
    if (demo[n.id]) n.signal = demo[n.id];
    if (n.id === 'mojo_energy') n.date_added = daysAgo(1);
  }
}

/* ---------------------------------------------------------------- render */

function render(graph) {
  const { width, height } = document.getElementById('stage').getBoundingClientRect();
  svg.attr('viewBox', [0, 0, width, height]);

  // II.3 static starfield: screen-space (outside the viewport transform), so
  // it neither pans nor zooms — identical backdrop on both maps.
  const starRand = (() => {
    let s = 42 >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
  })();
  const starLayer = svg.append('g').attr('id', 'starfield');
  for (let i = 0; i < 160; i++) {
    starLayer
      .append('circle')
      .attr('cx', starRand() * width)
      .attr('cy', starRand() * height)
      .attr('r', 0.4 + starRand() * 0.9)
      .attr('fill', '#cdd3ff')
      .attr('opacity', 0.1 + starRand() * 0.35);
  }

  const viewport = svg.append('g').attr('id', 'viewport').attr('class', 'zoomed-out');
  // Cartographic well labels — one layer per map, each faded by the active
  // landscape (cultural on .cultural-active, business otherwise).
  const culturalLabelLayer = viewport.append('g').attr('class', 'well-label-layer cultural-chrome');
  const businessLabelLayer = viewport.append('g').attr('class', 'well-label-layer business-chrome');
  const hullLayer = viewport.append('g');
  const linkLayer = viewport.append('g');
  const vectorLayer = viewport.append('g').attr('class', 'vector-layer cultural-chrome');
  // II.14 ghost mode: behind the live nodes, a dim duplicate at each entity's
  // previous-snapshot position + a fading connector to its current one. Empty
  // today (single snapshot); wired to populate the moment history exists.
  const ghostLayer = viewport.append('g').attr('class', 'ghost-layer');
  const nodeLayer = viewport.append('g');

  /* II.2 well anchors — attractors the position math pulls toward. Business
     anchors stay invisible; cultural anchors get faint cartographic labels
     (below) so placement on that map reads as meaning, not decoration. */
  const cx = width / 2;
  const cy = height / 2;
  const businessAnchors = new Map(
    BUSINESS_VERTICALS.map((v, i) => [
      v.id,
      { x: cx + ((i % 3) - 1) * BIZ_COL_STEP, y: cy + (Math.floor(i / 3) - 1) * BIZ_ROW_STEP },
    ])
  );
  const culturalAnchors = new Map(
    CULTURAL_VERTICALS.map((v, i) => {
      const a = (i / CULTURAL_VERTICALS.length) * 2 * Math.PI - Math.PI / 2;
      return [v.id, { x: cx + CULT_RX * Math.cos(a), y: cy + CULT_RY * Math.sin(a) }];
    })
  );
  const anchorsFor = (mapId) => (mapId === 'business' ? businessAnchors : culturalAnchors);

  /* Cultural well labels: same bearing as the true anchor, pulled inward to
     WELL_LABEL_RADIUS so the fitted view stays tight. Visible only on the
     Cultural Landscape (CSS-gated via #canvas.cultural-active). */
  const wellLabelPoints = CULTURAL_VERTICALS.map((v) => {
    const a = culturalAnchors.get(v.id);
    return { id: v.id, label: v.label, x: cx + (a.x - cx) * WELL_LABEL_RADIUS, y: cy + (a.y - cy) * WELL_LABEL_RADIUS };
  });
  const wellLabels = culturalLabelLayer
    .selectAll('text')
    .data(wellLabelPoints)
    .join('text')
    .attr('class', 'well-label')
    .attr('text-anchor', 'middle')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .text((d) => d.label.toUpperCase());

  /* Step 6: business well labels — same faint cartographic treatment on the
     3×3 grid of business anchors. Pushed radially outward from grid center so
     each label sits just beyond its cluster (the center well nudges up). */
  const BIZ_LABEL_OFFSET = 110;
  const businessLabelPoints = BUSINESS_VERTICALS.map((v) => {
    const a = businessAnchors.get(v.id);
    const dx = a.x - cx;
    const dy = a.y - cy;
    const len = Math.hypot(dx, dy);
    const x = len < 1 ? cx : a.x + (dx / len) * BIZ_LABEL_OFFSET;
    const y = len < 1 ? cy - 120 : a.y + (dy / len) * BIZ_LABEL_OFFSET;
    return { id: v.id, label: v.label, x, y };
  });
  businessLabelLayer
    .selectAll('text')
    .data(businessLabelPoints)
    .join('text')
    .attr('class', 'well-label business')
    .attr('text-anchor', 'middle')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .text((d) => d.label.toUpperCase());

  /* II.6 arrowhead marker (cultural accent — vectors only render there). */
  svg
    .append('defs')
    .append('marker')
    .attr('id', 'vector-head')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 8)
    .attr('refY', 5)
    .attr('markerWidth', 7)
    .attr('markerHeight', 7)
    .attr('orient', 'auto-start-reverse')
    .append('path')
    .attr('d', 'M 0 0 L 10 5 L 0 10 z')
    .attr('fill', '#ffd22e');

  // Layout links drive both the force simulation and the rendered edges.
  const layoutLinks = graph.links.map((l) => ({ ...l }));
  const families = buildFamilies(graph);

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force(
      'link',
      d3
        .forceLink(layoutLinks)
        .id((d) => d.id)
        // Spacing pass: satellites (adjacents) sit further off their hubs.
        .distance((d) => (d.relationship === 'direct_competitor' ? 108 : 156))
        .strength((d) =>
          // parent_of endpoints are both pinned semantically (positions /
          // centroids) — zero the spring so it can't fight the pins.
          d.relationship === 'parent_of' ? 0 : d.relationship === 'direct_competitor' ? 0.5 : 0.3
        )
    )
    .force(
      'charge',
      // Spacing pass: stronger repulsion so satellites fan out around a hub.
      d3.forceManyBody().strength((d) => (d.type === 'hub' ? -660 : d.type === 'parent' ? -580 : -180))
    )
    .force('collide', d3.forceCollide((d) => d.r + 13))
    .force('labelCollide', forceLabelCollide())
    // Weak containment only — placement comes from semantic pins (scored
    // nodes) and links (satellites), not from any regional force (§4f gone).
    .force('x', d3.forceX(cx).strength(0.03))
    .force('y', d3.forceY(cy).strength(0.03))
    .stop();

  /**
   * II.2: an entity's position on a map is the weighted average of that
   * map's well anchors; parents sit at the centroid of their children
   * (II.4's position rule, adopted early — full II.4 rendering comes later).
   */
  function semanticPositions(mapId) {
    const anchors = anchorsFor(mapId);
    const pos = new Map();
    for (const n of graph.nodes) {
      const p = weightedPosition(n.weights?.[mapId], anchors);
      if (p) pos.set(n.id, p);
    }
    for (const fam of families) {
      const c = centroid(fam.children.map((ch) => pos.get(ch.id)));
      if (c) pos.set(fam.parent.id, c);
    }
    return pos;
  }

  /**
   * Pin the semantic skeleton for one map, settle the free satellites around
   * it (links/charge/collision — §4d/§4e carried over), relax labels, and
   * snapshot every node. Nodes with no data for this map (v1 CSV nodes have
   * business-only weights) keep their previous coordinates: no cultural
   * data → they don't fly.
   */
  function settleMap(mapId, warm) {
    const pos = semanticPositions(mapId);
    for (const n of graph.nodes) {
      const p = pos.get(n.id);
      if (p) {
        n.x = n.fx = p.x;
        n.y = n.fy = p.y;
      } else if (warm && !(state.neighborHubs.get(n.id)?.size > 0) && n.weights?.business) {
        n.fx = n.x; // isolated business-only node: carry position, stay pinned
        n.fy = n.y;
      } else {
        n.fx = null;
        n.fy = null;
      }
    }
    // Entities with identical map profiles compute the EXACT same weighted
    // position (all single-dominant Business profiles stack per well; e.g.
    // Workday/Cisco share a cultural profile too). Seed coincident pinned
    // nodes with a tiny deterministic phyllotaxis offset so the relax pass
    // below can fan them out around the shared semantic point.
    const seen = new Map();
    for (const n of graph.nodes) {
      if (n.fx == null) continue;
      const key = `${Math.round(n.fx)},${Math.round(n.fy)}`;
      const count = seen.get(key) || 0;
      if (count > 0) {
        const a = count * 2.399963;
        // Spacing pass: wider fan so co-located same-profile hubs (a "cluster"
        // of standalone hubs sharing a dominant well) read as distinct.
        const r = 46 * Math.sqrt(count);
        n.x = n.fx = n.fx + r * Math.cos(a);
        n.y = n.fy = n.fy + r * Math.sin(a);
      }
      seen.set(key, count + 1);
    }

    simulation.alpha(0.9);
    for (let i = 0; i < SETTLE_TICKS; i++) simulation.tick();
    // Relax pass moves pins too (movePinned): stacked same-profile entities
    // separate for legibility while staying centered on their shared well —
    // the fan-out is rendering, not semantics.
    const relax = forceLabelCollide(true);
    relax.initialize(graph.nodes);
    for (let i = 0; i < 420; i++) relax();
    // II.4: one ring radius PER CHILD (that child's true distance from the
    // centroid), not a single mean — array length is constant (= children
    // count) across both maps, so the fly-toggle can interpolate index-wise.
    for (const fam of families) {
      const p = pos.get(fam.parent.id);
      fam.ring = fam.ring || {};
      fam.ring[mapId] = p ? fam.children.map((ch) => Math.hypot(ch.x - p.x, ch.y - p.y)) : [];
    }
    const snapshot = new Map();
    for (const n of graph.nodes) snapshot.set(n.id, { x: n.x, y: n.y, pinned: pos.has(n.id) });
    return snapshot;
  }

  // Dual settle: business from the cold phyllotaxis start, cultural warm-
  // started from the business result. Deterministic both ways — every node
  // ends up with two coordinates.
  const mapPositions = {
    business: settleMap('business', false),
    cultural: settleMap('cultural', true),
  };

  function applyMap(mapId) {
    state.map = mapId;
    for (const n of graph.nodes) {
      const p = mapPositions[mapId].get(n.id);
      n.homeX = n.x = p.x;
      n.homeY = n.y = p.y;
      if (p.pinned) {
        n.fx = p.x;
        n.fy = p.y;
      } else {
        n.fx = null;
        n.fy = null;
      }
    }
    simulation.force('x').x((n) => n.homeX).strength(ANCHOR_STRENGTH);
    simulation.force('y').y((n) => n.homeY).strength(ANCHOR_STRENGTH);
    simulation.alpha(0);
  }
  applyMap('business');

  /* II.4 concentric family rings: one dashed ring per child, at that child's
     true independently-computed distance from the shared centroid — a
     rendering aid, not a layout mechanism. Grouped per family so every
     child's ring moves with the parent in one transform. */
  const orbitGroup = hullLayer
    .selectAll('g.orbit-family')
    .data(families)
    .join('g')
    .attr('class', 'orbit-family');
  const orbitRings = orbitGroup
    .selectAll('circle')
    .data((f) => [...f.ring[state.map]].sort((a, b) => b - a).map((r) => ({ r })))
    .join('circle')
    .attr('class', 'orbit-path')
    .attr('r', (d) => d.r);

  /* links */
  // Step 4: mark links touching an adjacent node so CSS can hide them
  // alongside the cloaked adjacents on the Cultural Landscape.
  const endpointType = (v) => (typeof v === 'object' ? v.type : state.nodesById.get(v)?.type);
  const touchesAdjacent = (l) => endpointType(l.source) === 'adjacent' || endpointType(l.target) === 'adjacent';
  const link = linkLayer
    .selectAll('line')
    .data(layoutLinks)
    .join('line')
    .attr('class', (d) => `link ${d.relationship}${touchesAdjacent(d) ? ' adjacent-link' : ''}`);

  /* II.6 signal vectors: one arrow per (signal, evidenced cultural well),
     pointing from the node toward that well's anchor — the signal's pull on
     the entity's cultural identity, rendered BEFORE any score change so one
     announcement can't overcorrect a stable position. Length and opacity
     step down across the 6 monthly decay levels; expired (>24wk) signals
     draw nothing. Wells come from signal.cultural_wells — provisionally
     hand-tagged at ingest until the Cultural Affinity Processor owns
     classification (II.11 / Part III). */
  const now = Date.now();
  const vectorData = [];
  for (const n of graph.nodes) {
    const level = arrowDecayLevel(n.signal, now);
    if (level === null || !Array.isArray(n.signal.cultural_wells)) continue;
    for (const well of n.signal.cultural_wells) {
      if (culturalAnchors.has(well)) vectorData.push({ node: n, well, level });
    }
  }
  const vector = vectorLayer
    .selectAll('line')
    .data(vectorData)
    .join('line')
    .attr('class', (d) => `signal-vector level-${d.level}`)
    .attr('marker-end', 'url(#vector-head)')
    .style('opacity', (d) => 0.9 - d.level * 0.14);

  function updateVectors() {
    vector.each(function (d) {
      const a = culturalAnchors.get(d.well);
      const angle = Math.atan2(a.y - d.node.y, a.x - d.node.x);
      const start = d.node.r + RING_GAP * d.node.rings.length + 4;
      const len = VECTOR_BASE_LEN - d.level * VECTOR_LEN_STEP;
      d3.select(this)
        .attr('x1', d.node.x + start * Math.cos(angle))
        .attr('y1', d.node.y + start * Math.sin(angle))
        .attr('x2', d.node.x + (start + len) * Math.cos(angle))
        .attr('y2', d.node.y + (start + len) * Math.sin(angle));
    });
  }

  /* nodes */
  const node = nodeLayer
    .selectAll('g.node')
    .data(graph.nodes)
    .join('g')
    // Step 4: type class lets CSS cloak adjacents on the Cultural Landscape.
    .attr('class', (d) => `node type-${d.type}`)
    .on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d);
    });

  node
    .append('circle')
    .attr('class', 'core')
    // §9/§11 revision: new additions pulse brighter for their first week —
    // this REPLACES the old red new-addition ring.
    .classed('new-pulse', (d) => d.isNew)
    .attr('r', (d) => d.r);

  /**
   * II.3 glow engine — the single writer of node fill/glow. Two modes:
   * - default: clients white, signaled non-clients gray with glow opacity
   *   fading with signal age (relevance already encodes strength × recency,
   *   including 6a.3 propagation), floor nodes dim placeholders.
   * - well isolation (cultural map): EVERY entity re-glows in the Cultural
   *   accent, intensity scaled to its STORED 0–5 score for the selected well
   *   — the score field directly, never distance-from-anchor (a node's
   *   position is a weighted average, so it can sit far from a well it
   *   scores 5 on).
   */
  function applyGlow() {
    const well = state.map === 'cultural' ? state.isolatedWell : null;
    node.select('circle.core').each(function (d) {
      const c = d3.select(this);
      c.classed('glow-client', false).classed('glow-floor', false);
      if (well) {
        const s = (d.cultural_verticals?.[well] || 0) / 5;
        c.style('fill', isolationFill(s))
          .style('opacity', 0.3 + 0.7 * s)
          .style(
            'filter',
            s > 0.02
              ? `drop-shadow(0 0 ${4 + 9 * s}px rgba(255,210,46,${0.2 + 0.75 * s}))`
              : 'none'
          );
        return;
      }
      c.style('opacity', null);
      // Step 3 / contrast pass: read the resolved glow triple (parents
      // aggregate children). Fills form a clear luminance ladder against the
      // near-black bg — client near-white, signaled a distinctly brighter
      // gray than floor (with a floor of presence even at low relevance).
      if (d.glowClient) {
        c.style('fill', '#f6f4ff').style('filter', null).classed('glow-client', true);
      } else if (!d.glowFloor) {
        const a = 0.4 + 0.5 * Math.min(1, d.glowRelevance);
        c.style('fill', '#b3b1c9').style(
          'filter',
          `drop-shadow(0 0 5px rgba(210,210,228,${a})) drop-shadow(0 0 12px rgba(185,185,212,${a * 0.6}))`
        );
      } else {
        c.style('fill', 'var(--floor-gray)').style('filter', null).classed('glow-floor', true);
      }
    });
  }
  applyGlow();

  /* II.3 gravity-well isolation rail — Cultural Landscape only. One well at
     a time; clicking the active button (or Clear) returns to default glow.
     The Business equivalent is explicitly out of scope this pass. */
  const rail = document.getElementById('well-rail');
  for (const v of CULTURAL_VERTICALS) {
    const btn = document.createElement('button');
    btn.dataset.well = v.id;
    btn.textContent = v.label;
    btn.title = `Isolate ${v.label}: glow scales to each entity's stored 0–5 score`;
    rail.appendChild(btn);
  }
  const clearBtn = document.createElement('button');
  clearBtn.className = 'well-clear';
  clearBtn.textContent = 'Clear';
  rail.appendChild(clearBtn);

  function setIsolatedWell(wellId) {
    state.isolatedWell = wellId;
    rail.querySelectorAll('button[data-well]').forEach((b) =>
      b.classList.toggle('active', b.dataset.well === wellId)
    );
    wellLabels.classed('active', (d) => d.id === wellId);
    applyGlow();
  }
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b === clearBtn) return setIsolatedWell(null);
    setIsolatedWell(b.dataset.well === state.isolatedWell ? null : b.dataset.well);
  });

  /* II.3 map accent + rail visibility follow the active landscape; well
     labels and signal vectors are cultural-only (CSS fades on the class). */
  function applyMapChrome(mapId) {
    document.documentElement.style.setProperty('--map-accent', MAP_ACCENT[mapId]);
    document.getElementById('canvas').classList.toggle('cultural-active', mapId === 'cultural');
    rail.classList.toggle('hidden', mapId !== 'cultural');
    if (mapId !== 'cultural' && state.isolatedWell) setIsolatedWell(null);
    else applyGlow();
  }
  applyMapChrome(state.map);

  // Concentric ring stack (open question #9/#11): color-only at default zoom,
  // text labels past the zoom threshold.
  node.each(function (d) {
    const g = d3.select(this);
    d.rings.forEach((ring, i) => {
      const rr = d.r + RING_GAP * (i + 1);
      g.append('circle').attr('class', `ring ${ring}`).attr('r', rr);
      g.append('text')
        .attr('class', `ring-label ${ring}`)
        .attr('text-anchor', 'middle')
        .attr('y', -(rr + 1.5))
        .text(ring === 'signal' ? 'SIGNAL' : 'SISTER');
    });
  });

  node
    .append('text')
    .attr('class', (d) => `node-label${d.type === 'adjacent' ? ' adjacent-label' : ''}`)
    .attr('text-anchor', 'middle')
    .attr('y', (d) => d.r + RING_GAP * d.rings.length + 12)
    .text((d) => d.name);

  /* zoom + pan (Section 4a): camera change only, independent of layout */
  const zoom = d3
    .zoom()
    .scaleExtent([0.25, 8])
    .filter((event) => !event.target.closest('.node'))
    .on('zoom', (event) => {
      state.k = event.transform.k;
      viewport.attr('transform', event.transform);
      viewport
        .classed('zoomed-in', state.k >= RING_LABEL_ZOOM)
        .classed('zoomed-out', state.k < ADJ_LABEL_ZOOM);
    });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', () => clearSelection());

  // Default view = the active map's node extents, fit with padding. The two
  // landscapes have different footprints (grid vs ellipse), so fit follows
  // the map being shown.
  function fitTransform(mapId = state.map) {
    // Both maps fit their well-label ring into the default view, so the
    // labels that give placement its meaning are on screen from the start
    // (wider pad: labels are middle-anchored and extend past their points).
    const pad = 130;
    const pts = [...mapPositions[mapId].values()];
    pts.push(...(mapId === 'cultural' ? wellLabelPoints : businessLabelPoints));
    const xs = d3.extent(pts, (p) => p.x);
    const ys = d3.extent(pts, (p) => p.y);
    const dx = xs[1] - xs[0] + pad * 2;
    const dy = ys[1] - ys[0] + pad * 2;
    const k = Math.min(width / dx, height / dy, 1.4);
    return d3.zoomIdentity
      .translate(width / 2 - k * (xs[0] + xs[1]) / 2, height / 2 - k * (ys[0] + ys[1]) / 2)
      .scale(k);
  }
  document.getElementById('reset-view').addEventListener('click', () => {
    svg.transition().duration(500).call(zoom.transform, fitTransform());
  });

  /* II.2 map toggle: every node flies from its current-map position to its
     other-map position — the travel distance itself is the signal (a company
     that barely moves behaves conventionally for its category). */
  let flying = false;
  function switchMap(mapId) {
    if (flying || mapId === state.map) return;
    flying = true;
    state.map = mapId;
    document.querySelectorAll('#map-toggle button').forEach((b) =>
      b.classList.toggle('active', b.dataset.map === mapId)
    );
    applyMapChrome(mapId);
    const targets = mapPositions[mapId];
    const starts = new Map(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    // II.4: ring arrays are index-aligned per child across both maps, so a
    // family's rings interpolate the same way node x/y do — no rebinding.
    const ringStarts = new Map(
      families.map((f) => [f, f.renderRing ?? f.ring[mapId === 'business' ? 'cultural' : 'business']])
    );

    d3.select({})
      .transition()
      .duration(MAP_TRANSITION_MS)
      .ease(d3.easeCubicInOut)
      .tween('fly', () => (t) => {
        for (const n of graph.nodes) {
          const s = starts.get(n.id);
          const p = targets.get(n.id);
          n.x = s.x + (p.x - s.x) * t;
          n.y = s.y + (p.y - s.y) * t;
          if (n.fx != null) {
            n.fx = n.x;
            n.fy = n.y;
          }
        }
        for (const f of families) {
          const from = ringStarts.get(f) || [];
          f.renderRing = f.ring[mapId].map((target, i) => {
            const start = from[i] ?? target;
            return start + (target - start) * t;
          });
        }
        // Count per family never changes (= children.length, both maps), so
        // this is a plain positional update — no enter/exit needed.
        orbitRings
          .data((f) => [...f.renderRing].sort((a, b) => b - a).map((r) => ({ r })))
          .attr('r', (d) => d.r);
        ticked();
      })
      .on('end', () => {
        for (const n of graph.nodes) {
          const p = targets.get(n.id);
          n.homeX = n.x = p.x;
          n.homeY = n.y = p.y;
          if (p.pinned) {
            n.fx = p.x;
            n.fy = p.y;
          } else {
            n.fx = null;
            n.fy = null;
          }
        }
        simulation.force('x').x((n) => n.homeX);
        simulation.force('y').y((n) => n.homeY);
        flying = false;
      });
    svg.transition().duration(MAP_TRANSITION_MS).ease(d3.easeCubicInOut).call(zoom.transform, fitTransform(mapId));
  }
  document.querySelectorAll('#map-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => switchMap(btn.dataset.map));
  });
  svg.call(zoom.transform, fitTransform());

  /* II.14 ghost mode: a dim duplicate at each entity's PREVIOUS-snapshot
     position, joined to its current position by a thin fading connector — a
     "where it came from" trail. Positions are per map. No history exists yet
     (single snapshot), so previousPositions() is empty and nothing renders;
     the moment a second snapshot lands on graph.previous_positions the trail
     appears with zero further wiring. `?ghost=1` synthesizes an offset prior
     position purely to exercise/verify this path today. */
  const ghostDemo = new URLSearchParams(location.search).has('ghost');
  function previousPositions(mapId) {
    const prev = new Map();
    const source = state.graph.previous_positions?.[mapId]; // { id: {x, y} }
    if (source) {
      for (const n of graph.nodes) if (source[n.id]) prev.set(n.id, source[n.id]);
    } else if (ghostDemo) {
      for (const n of graph.nodes) {
        const p = mapPositions[mapId].get(n.id);
        if (p) prev.set(n.id, { x: p.x - 46, y: p.y - 30 });
      }
    }
    return prev;
  }
  const ghost = ghostLayer
    .selectAll('g.ghost')
    .data(graph.nodes, (d) => d.id)
    .join((enter) => {
      const g = enter.append('g').attr('class', (d) => `ghost type-${d.type}`);
      g.append('line').attr('class', 'ghost-link');
      g.append('circle').attr('class', 'ghost-node');
      return g;
    });
  function updateGhosts() {
    const prev = previousPositions(state.map);
    ghost.each(function (d) {
      const g = d3.select(this);
      const p = prev.get(d.id);
      if (!p) return g.style('display', 'none');
      g.style('display', null);
      g.select('circle.ghost-node').attr('cx', p.x).attr('cy', p.y).attr('r', d.r);
      g.select('line.ghost-link').attr('x1', p.x).attr('y1', p.y).attr('x2', d.x).attr('y2', d.y);
    });
  }

  /* tick */
  function ticked() {
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);
    orbitGroup.attr('transform', (d) => `translate(${d.parent.x},${d.parent.y})`);
    updateVectors();
    updateGhosts();
  }
  simulation.on('tick', ticked);
  ticked();

  // §5c ambient drift: a continuous render loop layering a tiny sinusoidal
  // offset onto each node's true position. The simulation's coordinates are
  // never touched — this is the "stars drift gently at rest" effect.
  if (DRIFT_AMPLITUDE > 0) {
    d3.timer((t) => {
      node.attr('transform', (d) => {
        const dx = DRIFT_AMPLITUDE * Math.sin(t * DRIFT_SPEED + d.driftPhase);
        const dy = DRIFT_AMPLITUDE * Math.cos(t * DRIFT_SPEED * 0.83 + d.driftPhase * 1.7);
        return `translate(${d.x + dx},${d.y + dy})`;
      });
    });
  }

  /* §4g combined filters: lens + signals-only + competitor-dim compose
     multiplicatively — a node renders at full strength only if it passes
     EVERY active filter. Visibility treatment only; nodes never move (§4). */
  function passes(n) {
    if (!inLens(n, state.lens)) return false;
    if (state.signalsOnly && !n.signal) return false; // active signal ring
    if (state.dimCompetitors && n.type === 'adjacent') return false;
    return true;
  }

  function applyFilters() {
    node.classed('dimmed', (d) => !passes(d));
    link.classed('dimmed', (d) => !passes(d.source) || !passes(d.target));
    vector.classed('dimmed', (d) => !passes(d.node));
    orbitGroup.classed('dimmed', (d) => ![d.parent, ...d.children].some((m) => passes(m)));
    // Competitor-dim hides adjacent labels entirely (§4g: decluttered view,
    // not a partial one) — the circles dim, the labels go away.
    viewport.classed('competitors-hidden', state.dimCompetitors);
  }

  document.querySelectorAll('#lens-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#lens-toggle button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.lens = btn.dataset.lens;
      applyFilters();
    });
  });
  document.getElementById('toggle-signals').addEventListener('click', (e) => {
    state.signalsOnly = !state.signalsOnly;
    e.currentTarget.classList.toggle('active', state.signalsOnly);
    applyFilters();
  });
  document.getElementById('toggle-competitors').addEventListener('click', (e) => {
    state.dimCompetitors = !state.dimCompetitors;
    e.currentTarget.classList.toggle('active', state.dimCompetitors);
    applyFilters();
  });

  function selectNode(d) {
    state.selected = d;
    node.classed('selected', (n) => n.id === d.id);
    // §4h: selection highlights ALL of the node's connectors — competitor,
    // analogous-audience, parent/subsidiary — and its neighbors; everything
    // else dims (harder on the Cultural Landscape, §II.13 — see CSS).
    const neighbors = new Set();
    for (const l of layoutLinks) {
      if (l.source === d) neighbors.add(l.target);
      if (l.target === d) neighbors.add(l.source);
    }
    viewport.classed('has-selection', true);
    link.classed('connected', (l) => l.source === d || l.target === d);
    node.classed('neighbor', (n) => neighbors.has(n));
    showPanel(d);
  }

  function clearSelection() {
    state.selected = null;
    viewport.classed('has-selection', false);
    node.classed('selected', false).classed('neighbor', false);
    link.classed('connected', false);
    panel.classList.add('hidden');
  }

  document.getElementById('panel-close').addEventListener('click', clearSelection);

  /* search — direct jump-to-brand alongside browsing (open question #6) */
  const datalist = document.getElementById('search-list');
  for (const n of [...graph.nodes].sort((a, b) => a.name.localeCompare(b.name))) {
    const opt = document.createElement('option');
    opt.value = n.name;
    datalist.appendChild(opt);
  }
  document.getElementById('search').addEventListener('change', (e) => {
    const match = graph.nodes.find((n) => n.name.toLowerCase() === e.target.value.toLowerCase());
    if (!match) return;
    const t = d3.zoomIdentity
      .translate(width / 2 - match.homeX * 1.8, height / 2 - match.homeY * 1.8)
      .scale(1.8);
    selectNode(match);
    svg.transition().duration(600).call(zoom.transform, t);
    e.target.blur();
  });

  applyFilters();

  // Debug hook for force-tuning sessions (harmless in production).
  window.__cluster = { state, simulation, mapPositions, switchMap, families };
}

/* NOTE: the §6a.1a orbit-exclusion force was removed with Map Engine v2 —
   II.4 says the exclusion concept needs fresh design for the multi-radius
   concentric model rather than being carried over. */

/* ------------------------------------------- label collision force (4d) */

/**
 * Always-on collision on label BOUNDING BOXES, not just node circles (§4d).
 * Runs every simulation tick — including the initial settle, which is where
 * the Cayman Jack/Olé label overlap came from — so the default auto-layout
 * is label-aware, not just cleaned up after the fact.
 *
 * Overlapping boxes are pushed apart along the axis of least overlap. Like
 * d3.forceCollide, the push is an iterative positional constraint NOT scaled
 * by alpha — otherwise it fades away exactly when the layout is settling.
 * O(n²) pairwise is fine at this graph size (~130 nodes).
 */
function forceLabelCollide(movePinned = false) {
  let nodes;
  const strength = 0.5;

  // movePinned (relax-pass only): identical-profile entities land on the
  // EXACT same semantic point on a map, and both are pinned — someone has to
  // give. In the post-settle relax the pins themselves fan out around the
  // shared point (fx/fy shift with x/y); during the live simulation pins are
  // sacrosanct (user drags, semantic anchors).
  const shift = (n, dx, dy) => {
    n.x += dx;
    n.y += dy;
    if (n.fx != null) {
      n.fx += dx;
      n.fy += dy;
    }
  };

  function force() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ay = a.y + a.boxCy;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const ox = a.boxHw + b.boxHw - Math.abs(b.x - a.x);
        if (ox <= 0) continue;
        const by = b.y + b.boxCy;
        const oy = a.boxHh + b.boxHh - Math.abs(by - ay);
        if (oy <= 0) continue;
        const aFree = movePinned || a.fx == null;
        const bFree = movePinned || b.fx == null;
        if (!aFree && !bFree) continue; // both pinned/dragged — leave them
        if (aFree && bFree) {
          // Both movable: split the push along the axis of least overlap.
          if (ox < oy) {
            const push = ox * 0.5 * strength * (b.x > a.x ? 1 : -1);
            shift(a, -push, 0);
            shift(b, push, 0);
          } else {
            const push = oy * 0.5 * strength * (by > ay ? 1 : -1);
            shift(a, 0, -push);
            shift(b, 0, push);
          }
        } else {
          // One side is pinned (user placement): push the free node RADIALLY
          // away from the pinned box. Axis pushes cancel when a node is
          // squeezed in the corridor between two pinned boxes; radial pushes
          // compose outward and let it escape.
          const free = aFree ? a : b;
          const pin = aFree ? b : a;
          let vx = free.x - pin.x;
          let vy = free.y + free.boxCy - (pin.y + pin.boxCy);
          const len = Math.hypot(vx, vy) || 1;
          const push = Math.min(ox, oy) * strength;
          shift(free, (vx / len) * push, (vy / len) * push);
        }
      }
    }
  }

  force.initialize = (n) => (nodes = n);
  return force;
}

/* -------------------------------------------------------------- families */

function buildFamilies(graph) {
  const families = [];
  for (const parent of graph.nodes.filter((n) => n.type === 'parent')) {
    const children = graph.nodes.filter((n) => n.parent === parent.id);
    if (children.length >= 1) families.push({ parent, children });
  }
  return families;
}

/* ----------------------------------------------------------------- panel */

function showPanel(d) {
  const eff = state.effective.get(d.id);
  const parts = [];

  parts.push(`<h2>${esc(d.name)}</h2>`);
  const sub = [d.type === 'hub' ? 'G7 client hub' : d.type === 'parent' ? 'Corporate parent' : 'Adjacent brand'];
  if (d.category) sub.push(esc(d.category));
  parts.push(`<div class="subtitle">${sub.join(' · ')}</div>`);

  const badges = [];
  if (d.is_g7_client) badges.push('<span class="badge client">G7 CLIENT</span>');
  if (d.zone) badges.push(`<span class="badge zone">${esc(d.zone.toUpperCase())}</span>`);
  if (d.signal) {
    badges.push(
      d.signal.type === 'rfp'
        ? '<span class="badge rfp">RFP EVENT</span>'
        : '<span class="badge signal">SIGNAL STACKS</span>'
    );
  }
  if (d.sister_agency) badges.push('<span class="badge sister">SISTER AGENCY</span>');
  if (badges.length) parts.push(`<p>${badges.join(' ')}</p>`);

  /* Step 7: radar (spike burst) + cultural accordion sit at the top, right
     under the header — the entity's cultural profile at a glance. */
  if (d.cultural_verticals) {
    parts.push(radarSpikeBurst(d.cultural_verticals));
    parts.push(culturalAccordion(d.cultural_verticals));
  }

  /* relevance / signal state */
  parts.push('<h3>Signal</h3>');
  if (d.floor && d.is_g7_client) {
    parts.push('<p class="rel-note">Confirmed G7 client — glows white regardless of live-signal status (II.3). No live signal on record yet.</p>');
  } else if (d.floor) {
    parts.push('<p class="rel-note">Floor state — no live signal yet. Here as research/environmental context; Signal Stacks lights this up when a real signal arrives.</p>');
  } else {
    const pct = Math.round((eff?.relevance || 0) * 100);
    parts.push(`<div class="relevance-bar"><div style="width:${pct}%"></div></div>`);
    parts.push(`<p class="rel-note">Relevance ${pct}%`);
    if (eff && eff.hops > 0) {
      const from = state.nodesById.get(eff.from);
      parts.push(
        ` — proximity signal${eff.hops > 1 ? ' once removed' : ''} (×${state.config.propagation_multipliers[eff.hops]}) propagated from <strong>${esc(from ? from.name : eff.from)}</strong>`
      );
    } else if (d.signal) {
      parts.push(
        ` — direct ${d.signal.type === 'rfp' ? 'RFP' : 'Signal Stacks'} signal, strength ${d.signal.strength}, ${esc(d.signal.date)}`
      );
    }
    parts.push('</p>');
  }

  /* Step 2: Notable factors — a plain, unscored list. Only lines that are
     actually true for the entity appear; no math, synthesis, or verdict (the
     G7 Gravity composite was removed). Cultural strength lives in the radar
     above, not here. */
  const notable = [];
  if (d.is_g7_client) notable.push('Existing G7 client');
  if (d.sister_agency) notable.push('Sister-agency relationship');
  if (d.signal) {
    const wells = Array.isArray(d.signal.cultural_wells)
      ? d.signal.cultural_wells.map(wellLabel).filter(Boolean)
      : [];
    const evidenced = wells.length ? `, evidenced for ${esc(wells.join(', '))}` : '';
    notable.push(`Signal detected — ${esc(elapsedSince(d.signal.date))}${evidenced}`);
  }
  if (notable.length) {
    parts.push('<h3>Notable factors</h3><ul>');
    for (const line of notable) parts.push(`<li>${line}</li>`);
    parts.push('</ul>');
  }

  /* II.1 vertical profiles — displayed as 0–5 (stored as normalized weights) */
  const profileSection = (title, scores, taxonomy) => {
    const rows = taxonomy
      .filter((v) => (scores?.[v.id] || 0) > 0)
      .sort((a, b) => scores[b.id] - scores[a.id])
      .map((v) => `<li>${esc(v.label)} — <strong>${esc(scores[v.id])}</strong>/5</li>`);
    if (rows.length) parts.push(`<h3>${title}</h3><ul>${rows.join('')}</ul>`);
  };
  // Cultural profile is the radar + accordion above; only the business list
  // stays as text (no business radar this pass).
  if (d.business_verticals) {
    profileSection('Business profile (0–5)', d.business_verticals, BUSINESS_VERTICALS);
  }

  /* notes */
  if (d.g7_notes) {
    if (d.g7_notes.case_study_learnings) {
      parts.push('<h3>Case study learnings</h3>');
      parts.push(`<p>${esc(d.g7_notes.case_study_learnings)}</p>`);
    }
    if (d.g7_notes.relationship_notes) {
      parts.push('<h3>Relationship</h3>');
      parts.push(`<p>${esc(d.g7_notes.relationship_notes)}</p>`);
    }
    if (d.g7_notes.category_note) {
      parts.push('<h3>Category note</h3>');
      parts.push(`<p>${esc(d.g7_notes.category_note)}</p>`);
    }
    if (d.g7_notes.licensor_or_agency) {
      parts.push('<h3>Licensor / agency (best guess — verify before outreach)</h3>');
      parts.push(
        `<p>${esc(d.g7_notes.licensor_or_agency)}${d.g7_notes.licensor_last_verified ? ` <span class="rel-note">(last verified ${esc(d.g7_notes.licensor_last_verified)})</span>` : ''}</p>`
      );
    }
  }

  /* relationships (competitor / analogous audience / corporate family) */
  const rels = state.graph.links.filter(
    (l) => linkIdOf(l.source) === d.id || linkIdOf(l.target) === d.id
  );
  if (rels.length) {
    const grouped = d3.group(rels, (l) => l.relationship);
    for (const [rel, list] of grouped) {
      parts.push(`<h3>${relLabel(rel)}</h3><ul>`);
      for (const l of list) {
        const otherId = linkIdOf(l.source) === d.id ? linkIdOf(l.target) : linkIdOf(l.source);
        const other = state.nodesById.get(otherId);
        if (!other) continue;
        parts.push(
          `<li>${esc(other.name)}${l.note ? `<br><span class="rel-note">${esc(l.note)}</span>` : ''}</li>`
        );
      }
      parts.push('</ul>');
    }
  }

  /* talent history (Section 10.4) — gated on the Backbone Sheet talent_name field */
  if (d.type === 'hub' && (d.zone === 'talent' || d.zone === 'combo')) {
    parts.push('<h3>Talent history</h3>');
    parts.push(
      '<p class="rel-note">Sourced from the Signal Stacks Backbone Sheet once the structured <code>talent_name</code> field exists (Flag 5). Last 5–10 partners will list here, with a full-list expand.</p>'
    );
  }

  /* §6c: extend the map outward from live signals — Signal-ringed nodes only */
  if (d.signal) {
    parts.push('<h3>Extend the map</h3>');
    parts.push('<p><button id="gen-competitors">Generate Competitors</button></p>');
    parts.push('<p class="rel-note" id="gen-status"></p>');
  }

  panelContent.innerHTML = parts.join('');
  panel.classList.remove('hidden');
  wireGenerateCompetitors(d);
}

/**
 * §6c on-demand competitor search. The Claude call runs server-side in the
 * Worker (same proxy pattern as Scout — the API key never reaches the
 * browser); this just POSTs the node id and shows progress. New/connected
 * competitors land in the served graph, so the map reloads to show them.
 */
function wireGenerateCompetitors(d) {
  const btn = document.getElementById('gen-competitors');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    let secret = localStorage.getItem('cluster_secret');
    if (!secret) {
      secret = window.prompt('Trigger secret (stored in this browser for future searches):') || '';
      if (!secret) return;
      localStorage.setItem('cluster_secret', secret);
    }
    const status = document.getElementById('gen-status');
    btn.disabled = true;
    status.textContent = 'Searching';
    status.classList.add('searching');
    try {
      const resp = await fetch('/api/competitors/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ node_id: d.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);
      status.classList.remove('searching');
      const bits = [`${data.added.length} new`];
      if (data.connected.length) bits.push(`${data.connected.length} connected to existing nodes`);
      status.textContent = `Found ${bits.join(', ')} — refreshing map…`;
      setTimeout(() => location.reload(), 1400);
    } catch (err) {
      status.classList.remove('searching');
      status.textContent = `Error: ${err.message}`;
      btn.disabled = false;
      if (/HTTP 401/.test(err.message)) localStorage.removeItem('cluster_secret');
    }
  });
}

const linkIdOf = (v) => (typeof v === 'object' ? v.id : v);

function relLabel(rel) {
  return (
    {
      direct_competitor: 'Direct competitors',
      analogous_audience: 'Analogous audience',
      parent_of: 'Corporate family',
    }[rel] || rel
  );
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

const wellLabel = (id) => CULTURAL_VERTICALS.find((v) => v.id === id)?.label || id;

/** Plain human-elapsed for the Notable-factors signal line (no decay math). */
function elapsedSince(dateStr) {
  const ms = Date.parse(dateStr);
  if (Number.isNaN(ms)) return 'recently';
  const days = Math.max(0, Math.round((Date.now() - ms) / 86400000));
  if (days === 0) return 'today';
  if (days < 14) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

// Terse axis labels — the accordion below carries the full names + scores.
const WELL_SHORT = {
  music_performance: 'Music',
  sports: 'Sports',
  gaming: 'Gaming',
  comedy: 'Comedy',
  festival: 'Festival',
  talent_celebrity_partnerships: 'Talent',
  film_tv: 'Film/TV',
  inclusion: 'Inclusion',
  college_marketing: 'College',
  outdoor_adventure: 'Outdoor',
  inter_brand_collaborations: 'Collabs',
  creator_influencer_partnerships: 'Creator',
  wellness_fitness: 'Wellness',
};

/**
 * Step 7 radar — SPIKE BURST: each of the 13 cultural wells is an INDEPENDENT
 * triangular spike from center to its scored vertex. No connecting polygon,
 * no blending between axes (visually or mathematically) — each spike is a
 * standalone triangle so a high score on one well never visually "fills in"
 * toward its neighbors.
 */
function radarSpikeBurst(scores) {
  const size = 300;
  const cx0 = size / 2;
  const cy0 = 148;
  const maxR = 92;
  const n = CULTURAL_VERTICALS.length;
  const parts = [];
  // Faint reference rings at 1/3, 2/3, full so spike length reads as a score.
  for (const frac of [1 / 3, 2 / 3, 1]) {
    parts.push(`<circle class="radar-ring" cx="${cx0}" cy="${cy0}" r="${(maxR * frac).toFixed(1)}" />`);
  }
  CULTURAL_VERTICALS.forEach((v, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    parts.push(
      `<line class="radar-axis" x1="${cx0}" y1="${cy0}" x2="${(cx0 + cos * maxR).toFixed(1)}" y2="${(cy0 + sin * maxR).toFixed(1)}" />`
    );
    const s = Math.max(0, Math.min(5, Number(scores[v.id]) || 0));
    if (s > 0) {
      const r = (s / 5) * maxR;
      const apexX = cx0 + cos * r;
      const apexY = cy0 + sin * r;
      const bw = 5; // base half-width — narrow so spikes stay distinct
      const px = -sin * bw;
      const py = cos * bw;
      parts.push(
        `<path class="radar-spike" d="M${(cx0 + px).toFixed(1)},${(cy0 + py).toFixed(1)} L${apexX.toFixed(1)},${apexY.toFixed(1)} L${(cx0 - px).toFixed(1)},${(cy0 - py).toFixed(1)} Z" />`
      );
    }
    const lx = cx0 + cos * (maxR + 11);
    const ly = cy0 + sin * (maxR + 11);
    const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
    parts.push(
      `<text class="radar-axis-label" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}">${esc(WELL_SHORT[v.id] || v.label)}</text>`
    );
  });
  return `<svg class="radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="Cultural affinity spike burst">${parts.join('')}</svg>`;
}

const RUBRIC_SUBFACTORS = [
  'Historical Depth',
  'Recurrence',
  'Strategic Importance',
  'Recent Momentum',
  'Breadth of Activity',
];

/**
 * Step 7 accordion — one <details> row per cultural well (name + current
 * score). Expanding reveals the five rubric sub-factors, each 'pending': the
 * Cultural Affinity Processor will populate them. No fabricated numbers.
 */
function culturalAccordion(scores) {
  const rows = CULTURAL_VERTICALS.map((v) => {
    const s = Math.max(0, Math.min(5, Number(scores[v.id]) || 0));
    const subs = RUBRIC_SUBFACTORS.map(
      (r) => `<div class="rubric-row"><span>${esc(r)}</span><span class="pending">pending</span></div>`
    ).join('');
    return `<details class="cult-row"><summary><span class="cult-name">${esc(v.label)}</span><span class="cult-score">${s}/5</span></summary><div class="rubric">${subs}<p class="rel-note">Populates once the Cultural Affinity Processor is live.</p></div></details>`;
  }).join('');
  return `<h3>Cultural categories</h3><div class="accordion">${rows}</div>`;
}
