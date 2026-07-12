/**
 * G7 Cluster Study — NBD hub-and-spoke view.
 *
 * Layout model (Plan Section 4): anchored default positions. One deterministic
 * force settle on load decides where everything lives; a gentle anchor force
 * pulls each node back to that home position after any drag (Section 4b,
 * Obsidian-style). Lens switching changes visibility treatment only —
 * dim/desaturate, never reposition — so spatial memory holds.
 *
 * Visual grammar (Section 5): ring = active signal exists; fill darkness =
 * relevance (purple gradient); static gray = floor state (no signal ever).
 * Corporate families get convex hulls (Section 6a.1); structural analogs
 * render only while a node is selected (Section 6a.7).
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
} from '/scoring.js';
import { nearestFreeCell, cellOf, cellKey } from '/layout.js';
import {
  BUSINESS_VERTICALS,
  CULTURAL_VERTICALS,
  normalizeScores,
  weightedPosition,
  centroid,
  LEGACY_SECTOR_TO_BUSINESS,
} from '/verticals.js';

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
// Business wells: 3×2 grid of anchor points (6 verticals).
const BIZ_COL_STEP = 720;
const BIZ_ROW_STEP = 660;
// Cultural wells: 12 anchor points on an ellipse.
const CULT_RX = 900;
const CULT_RY = 640;

const state = {
  graph: null,
  config: DEFAULT_CONFIG,
  lens: 'all',
  signalsOnly: false, // §4g
  dimCompetitors: false, // §4g
  map: 'business', // II.2: active landscape
  selected: null,
  k: 1,
  effective: new Map(),
  nodesById: new Map(),
  neighborHubs: new Map(), // adjacent/parent id -> Set(hub ids) for lens membership
  analogPairs: [],
};

// §5c dark canvas flips the relevance encoding direction: on a star chart,
// MORE relevance = a BRIGHTER star (same meaning — more salient — as "darker"
// was on the light background).
// Non-client fill: dim violet → bright lavender by relevance (only once a
// real live signal exists — otherwise floor-gray).
const fillScale = d3.interpolateRgb('#3c3357', '#b79aff');
// §5a client fill: confirmed G7 clients are ALWAYS purple — a clearly-purple
// resting shade, brightening within the family as signals arrive.
const clientFillScale = d3.interpolateRgb('#6a48b8', '#d4bfff');

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
  const resp = await fetch('/data');
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
  state.analogPairs = graph.structural_analogs || [];

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
      cultural: normalizeScores(n.cultural_verticals, CULTURAL_VERTICALS),
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
  const demo = {
    white_claw: { strength: 0.95, date: daysAgo(5), type: 'signal_stacks' },
    mikes_hard_lemonade: { strength: 0.9, date: daysAgo(2), type: 'signal_stacks' },
    subaru: { strength: 0.85, date: daysAgo(20), type: 'rfp' },
    liquid_death: { strength: 0.6, date: daysAgo(70), type: 'signal_stacks' },
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

  const viewport = svg.append('g').attr('id', 'viewport').attr('class', 'zoomed-out');
  const hullLayer = viewport.append('g');
  const linkLayer = viewport.append('g');
  const analogLayer = viewport.append('g');
  const nodeLayer = viewport.append('g');

  /* II.2 invisible well anchors — attractors the position math pulls toward,
     NOT rendered regions (well illumination is later-phase work, II.3). */
  const cx = width / 2;
  const cy = height / 2;
  const businessAnchors = new Map(
    BUSINESS_VERTICALS.map((v, i) => [
      v.id,
      { x: cx + ((i % 3) - 1) * BIZ_COL_STEP, y: cy + (Math.floor(i / 3) - 0.5) * BIZ_ROW_STEP },
    ])
  );
  const culturalAnchors = new Map(
    CULTURAL_VERTICALS.map((v, i) => {
      const a = (i / CULTURAL_VERTICALS.length) * 2 * Math.PI - Math.PI / 2;
      return [v.id, { x: cx + CULT_RX * Math.cos(a), y: cy + CULT_RY * Math.sin(a) }];
    })
  );
  const anchorsFor = (mapId) => (mapId === 'business' ? businessAnchors : culturalAnchors);

  // Structural analogs stay OUT of the layout links: not physical proximity,
  // not a persistent line (Section 6a.7).
  const layoutLinks = graph.links.map((l) => ({ ...l }));
  const families = buildFamilies(graph);

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force(
      'link',
      d3
        .forceLink(layoutLinks)
        .id((d) => d.id)
        // §4e spacing distances retained for satellite placement.
        .distance((d) => (d.relationship === 'direct_competitor' ? 90 : 130))
        .strength((d) =>
          // parent_of endpoints are both pinned semantically (positions /
          // centroids) — zero the spring so it can't fight the pins.
          d.relationship === 'parent_of' ? 0 : d.relationship === 'direct_competitor' ? 0.5 : 0.3
        )
    )
    .force(
      'charge',
      // §4e spacing: repulsion values carried over.
      d3.forceManyBody().strength((d) => (d.type === 'hub' ? -520 : d.type === 'parent' ? -450 : -140))
    )
    .force('collide', d3.forceCollide((d) => d.r + 8))
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
        const r = 34 * Math.sqrt(count);
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
    for (let i = 0; i < 260; i++) relax();
    // Family ring radius per map = mean child distance from the centroid —
    // a rendering stopgap until II.4's concentric rings.
    for (const fam of families) {
      const p = pos.get(fam.parent.id);
      fam.ring = fam.ring || {};
      fam.ring[mapId] = p ? d3.mean(fam.children, (ch) => Math.hypot(ch.x - p.x, ch.y - p.y)) : 0;
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

  // §4c persistence carried over this phase (II.5 retires dragging later):
  // a saved placement pins the node identically in BOTH maps — it won't fly
  // on toggle until "Reset layout".
  const saved = loadSavedLayout();
  for (const n of graph.nodes) {
    if (Array.isArray(saved[n.id])) {
      n.homeX = n.x = n.fx = saved[n.id][0];
      n.homeY = n.y = n.fy = saved[n.id][1];
    }
  }

  /* dashed family rings at per-map mean child distance (II.4 stopgap) */
  const orbits = hullLayer
    .selectAll('circle')
    .data(families)
    .join('circle')
    .attr('class', 'orbit-path')
    .attr('r', (d) => d.ring[state.map] || 0);

  /* links */
  const link = linkLayer
    .selectAll('line')
    .data(layoutLinks)
    .join('line')
    .attr('class', (d) => `link ${d.relationship}`);

  /* nodes */
  const node = nodeLayer
    .selectAll('g.node')
    .data(graph.nodes)
    .join('g')
    .attr('class', 'node')
    .call(dragBehavior(simulation, graph.nodes, families))
    .on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d);
    });

  node
    .append('circle')
    .attr('class', 'core')
    // §5b: shadows lift parents + owned clients off the canvas; adjacent and
    // floor-state nodes stay flat, reinforcing the §5a purple/gray split.
    .classed('elevated', (d) => d.is_g7_client || d.type === 'parent')
    // §9/§11 revision: new additions pulse brighter for their first week —
    // this REPLACES the old red new-addition ring.
    .classed('new-pulse', (d) => d.isNew)
    .attr('r', (d) => d.r)
    .attr('fill', (d) =>
      d.is_g7_client
        ? clientFillScale(d.relevance)
        : d.floor
          ? 'var(--floor-gray)'
          : fillScale(Math.max(0.06, d.relevance))
    );

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
    const pad = 80;
    const pts = [...mapPositions[mapId].values()];
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
    const targets = mapPositions[mapId];
    const savedNow = loadSavedLayout();
    const starts = new Map(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const ringStarts = new Map(families.map((f) => [f, f.renderRing ?? f.ring[mapId === 'business' ? 'cultural' : 'business']]));

    d3.select({})
      .transition()
      .duration(MAP_TRANSITION_MS)
      .ease(d3.easeCubicInOut)
      .tween('fly', () => (t) => {
        for (const n of graph.nodes) {
          if (Array.isArray(savedNow[n.id])) continue; // user-pinned: stays put
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
          const from = ringStarts.get(f) || 0;
          f.renderRing = from + ((f.ring[mapId] || 0) - from) * t;
        }
        orbits.attr('r', (f) => f.renderRing || 0);
        ticked();
      })
      .on('end', () => {
        for (const n of graph.nodes) {
          if (Array.isArray(savedNow[n.id])) continue;
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
  document.getElementById('reset-layout').addEventListener('click', () => {
    localStorage.removeItem(LAYOUT_KEY);
    location.reload();
  });
  svg.call(zoom.transform, fitTransform());

  /* tick — also runs during drags so hulls and links track live (4b) */
  function ticked() {
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);
    orbits.attr('cx', (d) => d.parent.x).attr('cy', (d) => d.parent.y);
    updateAnalogLines();
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
    orbits.classed('dimmed', (d) => ![d.parent, ...d.children].some((m) => passes(m)));
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

  /* selection-triggered structural analog highlight (Section 6a.7) */
  function updateAnalogLines() {
    const pairs = activeAnalogPairs();
    analogLayer
      .selectAll('line')
      .data(pairs, (p) => p.key)
      .join('line')
      .attr('class', 'analog-link')
      .attr('x1', (p) => p.a.x)
      .attr('y1', (p) => p.a.y)
      .attr('x2', (p) => p.b.x)
      .attr('y2', (p) => p.b.y);
    node.classed(
      'analog-partner',
      (d) => !!state.selected && pairs.some((p) => p.a.id === d.id || p.b.id === d.id) && d.id !== state.selected.id
    );
  }

  function activeAnalogPairs() {
    if (!state.selected) return [];
    return state.analogPairs
      .filter((p) => p.pair.includes(state.selected.id))
      .map((p) => ({
        key: p.pair.join('~'),
        a: state.nodesById.get(p.pair[0]),
        b: state.nodesById.get(p.pair[1]),
        note: p.note,
      }))
      .filter((p) => p.a && p.b);
  }

  function selectNode(d) {
    state.selected = d;
    node.classed('selected', (n) => n.id === d.id);
    // §4h: selection highlights ALL of the node's connectors — competitor,
    // analogous-audience, parent/subsidiary — and its neighbors; everything
    // else dims slightly. Structural-analog lines (6a.7) are the one case
    // where the edge is CREATED on selection; grounded edges just get
    // emphasized. Same rule, two renderings.
    const neighbors = new Set();
    for (const l of layoutLinks) {
      if (l.source === d) neighbors.add(l.target);
      if (l.target === d) neighbors.add(l.source);
    }
    viewport.classed('has-selection', true);
    link.classed('connected', (l) => l.source === d || l.target === d);
    node.classed('neighbor', (n) => neighbors.has(n));
    updateAnalogLines();
    showPanel(d);
  }

  function clearSelection() {
    state.selected = null;
    viewport.classed('has-selection', false);
    node.classed('selected', false).classed('analog-partner', false).classed('neighbor', false);
    link.classed('connected', false);
    updateAnalogLines();
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

/* ------------------------------------------------- drag (4b) + snap (4c) */

const LAYOUT_KEY = 'cluster_layout_v1';

function loadSavedLayout() {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {};
  } catch {
    return {};
  }
}

function saveNodePosition(id, x, y) {
  const all = loadSavedLayout();
  all[id] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
}

function dragBehavior(simulation, nodes, families) {
  // Dragging stays fluid (4b: neighbors respond through the live forces). On
  // release the node snaps to the nearest UNOCCUPIED grid cell and stays —
  // desktop-icon repositioning (§4c). The anchor force is what walks it onto
  // the cell, so the snap animates instead of teleporting.
  return d3
    .drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.25).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on('drag', (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);

      // Placed nodes stay pinned — link tension must not drag them off their
      // spot. Short tween so every release animates rather than teleporting.
      const glidePin = (target) => {
        const from = { x: event.x, y: event.y };
        d3.select({}).transition().duration(220).ease(d3.easeCubicOut).tween('snap', () => (t) => {
          d.fx = from.x + (target.x - from.x) * t;
          d.fy = from.y + (target.y - from.y) * t;
        });
      };

      const childFam = d.orbital ? families.find((f) => f.children.includes(d)) : null;
      if (childFam) {
        // §6a.1b orbit-locked release: a child dragged around (or away from)
        // its parent projects onto the orbit circle at the DROP angle —
        // radius normalized, NOT returned to its original slot. Lets users
        // reorder a crowded ring (MABI) without a child ever drifting off it.
        const p = childFam.parent;
        const angle = Math.atan2(event.y - p.y, event.x - p.x);
        const target = {
          x: p.x + childFam.radius * Math.cos(angle),
          y: p.y + childFam.radius * Math.sin(angle),
        };
        d.homeX = target.x;
        d.homeY = target.y;
        saveNodePosition(d.id, target.x, target.y); // reloaded as an angle (§6a.1b)
        glidePin(target);
      } else {
        // §4c grid snap for parents and free nodes. Occupancy: every other
        // node's home claims its containing cell, so two nodes can never
        // land on the same spot.
        const occupied = new Set();
        for (const n of nodes) {
          if (n !== d) occupied.add(cellKey(...cellOf(n.homeX, n.homeY)));
        }
        const cell = nearestFreeCell(event.x, event.y, occupied);
        const dx = cell.x - d.homeX;
        const dy = cell.y - d.homeY;
        d.homeX = cell.x;
        d.homeY = cell.y;
        saveNodePosition(d.id, cell.x, cell.y);
        glidePin(cell);
        if (d.type === 'parent') {
          // The whole orbit moves with its parent — INCLUDING user-placed
          // children, since their ring is defined by the parent (§6a.1b).
          const fam = families.find((f) => f.parent === d);
          for (const child of fam?.children || []) {
            child.homeX += dx;
            child.homeY += dy;
            const from = { x: child.x, y: child.y };
            const to = { x: child.homeX, y: child.homeY };
            d3.select({}).transition().duration(300).ease(d3.easeCubicOut).tween('follow', () => (t) => {
              child.x = child.fx = from.x + (to.x - from.x) * t;
              child.y = child.fy = from.y + (to.y - from.y) * t;
              child.vx = 0;
              child.vy = 0;
            });
          }
        }
      }
      // d3.forceX/Y cache their target accessor at initialization — homes
      // just changed, so re-point the anchors or they pull at stale spots.
      simulation.force('x').x((n) => n.homeX);
      simulation.force('y').y((n) => n.homeY);
      simulation.alpha(0.35).restart();
    });
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
  if (d.coi_sensitive) badges.push('<span class="badge coi">COI-SENSITIVE</span>');
  if (badges.length) parts.push(`<p>${badges.join(' ')}</p>`);

  /* relevance / signal state */
  parts.push('<h3>Signal</h3>');
  if (d.floor && d.is_g7_client) {
    parts.push('<p class="rel-note">Confirmed G7 client — renders in base G7 purple regardless of live-signal status (§5a). No live signal yet; a real signal will darken the shade.</p>');
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

  /* II.1 vertical profiles — displayed as 0–5 (stored as normalized weights) */
  const profileSection = (title, scores, taxonomy) => {
    const rows = taxonomy
      .filter((v) => (scores?.[v.id] || 0) > 0)
      .sort((a, b) => scores[b.id] - scores[a.id])
      .map((v) => `<li>${esc(v.label)} — <strong>${esc(scores[v.id])}</strong>/5</li>`);
    if (rows.length) parts.push(`<h3>${title}</h3><ul>${rows.join('')}</ul>`);
  };
  if (d.business_verticals || d.cultural_verticals) {
    profileSection('Business profile (0–5)', d.business_verticals, BUSINESS_VERTICALS);
    profileSection('Cultural profile (0–5)', d.cultural_verticals, CULTURAL_VERTICALS);
    parts.push(
      '<p class="rel-note">Provisional stub scoring (dominant vertical + rough derived secondaries) — real multi-vertical scoring is pending follow-up work.</p>'
    );
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

  /* relationships — COI surfaces here in the click-through, not on the map */
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
          `<li>${esc(other.name)}${l.coi_sensitive ? ' <span class="badge coi" title="' + esc(l.coi_note || 'Outreach-cautious') + '">COI</span>' : ''}${l.note ? `<br><span class="rel-note">${esc(l.note)}</span>` : ''}</li>`
        );
      }
      parts.push('</ul>');
    }
  }

  /* structural analogs (Section 6a.7 — shown only on selection) */
  const analogs = state.analogPairs.filter((p) => p.pair.includes(d.id));
  if (analogs.length) {
    parts.push('<h3>Structurally analogous client</h3><ul>');
    for (const p of analogs) {
      const otherId = p.pair[0] === d.id ? p.pair[1] : p.pair[0];
      const other = state.nodesById.get(otherId);
      parts.push(`<li>${esc(other ? other.name : otherId)}${p.note ? `<br><span class="rel-note">${esc(p.note)}</span>` : ''}</li>`);
    }
    parts.push('</ul>');
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
