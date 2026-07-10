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
} from '/scoring.js';
import {
  nearestFreeCell,
  cellOf,
  cellKey,
  orbitRadius,
  orbitalSlots,
  radialEscape,
} from '/layout.js';

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

/* §4f vertical sectors: six regions on a 3×2 star-chart grid. */
const SECTORS = [
  { id: 'food_beverage', label: 'FOOD & BEVERAGE', col: 0, row: 0 },
  { id: 'automotive', label: 'AUTOMOTIVE & TRANSPORTATION', col: 1, row: 0 },
  { id: 'tech_b2b', label: 'TECHNOLOGY & B2B', col: 2, row: 0 },
  { id: 'cpg', label: 'CPGs', col: 0, row: 1 },
  { id: 'sports', label: 'SPORTS', col: 1, row: 1 },
  { id: 'hospitality', label: 'HOSPITALITY / TRAVEL / TOURISM', col: 2, row: 1 },
];
// Cell size has to hold the largest sector (Food & Beverage: ~10 clusters
// including the MABI orbit) at current repulsion levels.
const SECTOR_W = 950;
const SECTOR_H = 800;

/**
 * Sector membership: hubs and parents classify explicitly; adjacent nodes
 * inherit their connected hubs' sector — EXCEPT the outdoor-lifestyle
 * override, which is what makes Subaru → REI/Yeti/Patagonia read as
 * cross-sector "trade routes" (§4f). A `sector` field carried in the graph
 * data (Sheet column / CSV ingestion) always wins over this map.
 */
const SECTOR_BY_NODE = {
  white_claw: 'food_beverage',
  mikes_hard_lemonade: 'food_beverage',
  cayman_jack: 'food_beverage',
  ole: 'food_beverage',
  fireball_whiskey: 'food_beverage',
  liquid_death: 'food_beverage',
  lagunitas: 'food_beverage',
  mojo_energy: 'food_beverage',
  mark_anthony_brands: 'food_beverage',
  swisher: 'food_beverage',
  ram_trucks: 'automotive',
  subaru: 'automotive',
  turbotax_intuit: 'tech_b2b',
  atlassian: 'tech_b2b',
  workday: 'tech_b2b',
  cisco: 'tech_b2b',
  intuit: 'tech_b2b',
  jackson_hole: 'hospitality',
  // Outdoor-lifestyle brands are CPGs (non-food packaged goods), not their
  // hubs' verticals.
  yeti: 'cpg',
  carhartt: 'cpg',
  rei: 'cpg',
  patagonia: 'cpg',
  the_north_face: 'cpg',
};

const state = {
  graph: null,
  config: DEFAULT_CONFIG,
  lens: 'all',
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
    n.rings = ringsFor(n, now, state.config);
    const eff = state.effective.get(n.id);
    n.relevance = eff ? eff.relevance : 0;
    n.floor = !n.signal && !eff;

    // §4d collision box: node circle + ring stack + label, as one AABB.
    // Text is wider than the circle it hangs from, so the box is label-driven.
    measureCtx.font = `${n.type === 'adjacent' ? 9 : 11}px ${FONT_STACK}`;
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

  // §4f sector assignment: data field wins, then the explicit map, then
  // majority inheritance from connected hubs (two passes so hubs resolve
  // before their satellites inherit).
  for (const n of graph.nodes) {
    if (!n.sector) n.sector = SECTOR_BY_NODE[n.id] || null;
  }
  for (const n of graph.nodes) {
    if (n.sector) continue;
    const counts = new Map();
    for (const hubId of state.neighborHubs.get(n.id) || []) {
      const s = state.nodesById.get(hubId)?.sector;
      if (s) counts.set(s, (counts.get(s) || 0) + 1);
    }
    for (const [s, c] of counts) {
      if (!n.sector || c > counts.get(n.sector)) n.sector = s;
    }
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
  const sectorLayer = viewport.append('g');
  const hullLayer = viewport.append('g');
  const linkLayer = viewport.append('g');
  const analogLayer = viewport.append('g');
  const nodeLayer = viewport.append('g');

  // §4f sector geometry: a 3×2 grid centered on the canvas, in world coords
  // (pans/zooms with the map). Sector force targets pull each node's settle
  // position into its vertical's region; empty sectors still render.
  const gridX0 = width / 2 - SECTOR_W * 1.5;
  const gridY0 = height / 2 - SECTOR_H;
  const sectorCenter = new Map(
    SECTORS.map((s) => [
      s.id,
      { x: gridX0 + (s.col + 0.5) * SECTOR_W, y: gridY0 + (s.row + 0.5) * SECTOR_H },
    ])
  );
  const sectorTarget = (d, axis) => {
    const c = d.sector && sectorCenter.get(d.sector);
    if (!c) return axis === 'x' ? width / 2 : height / 2;
    return c[axis];
  };

  // Structural analogs stay OUT of the layout links: not physical proximity,
  // not a persistent line (Section 6a.7).
  const layoutLinks = graph.links.map((l) => ({ ...l }));

  // §6a.1: families and orbit radii come first so the parent_of link force
  // and the orbital slots agree on the same distance — otherwise the link
  // force perpetually drags children off their slots.
  const families = buildFamilies(graph);
  const orbitOf = new Map();
  for (const fam of families) {
    fam.radius = orbitRadius(
      fam.children.length,
      fam.parent.r,
      d3.max(fam.children, (c) => 2 * c.boxHw),
      2 * fam.parent.boxHw
    );
    for (const child of fam.children) orbitOf.set(child.id, fam.radius);
  }

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force(
      'link',
      d3
        .forceLink(layoutLinks)
        .id((d) => d.id)
        .distance((d) =>
          // §4e spacing: competitor/audience links lengthened for breathing
          // room between clusters; parent_of stays locked to the orbit radius.
          d.relationship === 'parent_of'
            ? orbitOf.get(typeof d.target === 'object' ? d.target.id : d.target) || 90
            : d.relationship === 'direct_competitor'
              ? 90
              : 130
        )
        .strength((d) =>
          // §4f: a link SPANNING sectors is a trade route, not a spring — it
          // must not drag its endpoints out of their home sectors. Same-sector
          // links keep their structural strengths.
          d.source.sector && d.target.sector && d.source.sector !== d.target.sector
            ? 0.02
            : d.relationship === 'parent_of'
              ? 0.9
              : d.relationship === 'direct_competitor'
                ? 0.5
                : 0.3
        )
    )
    .force(
      'charge',
      // §4e spacing: stronger repulsion on cluster centers (hubs/parents) so
      // distinct clusters settle with clear whitespace between them.
      d3.forceManyBody().strength((d) => (d.type === 'hub' ? -520 : d.type === 'parent' ? -450 : -140))
    )
    .force('collide', d3.forceCollide((d) => d.r + 8))
    .force('orbitExclusion', forceOrbitExclusion(families))
    .force('labelCollide', forceLabelCollide())
    // §4f: the settle-time positional pull IS the sector force — each node
    // gravitates toward its vertical's region, layered under the link/orbit
    // forces. After settle, per-node anchors take over as before.
    .force('x', d3.forceX((d) => sectorTarget(d, 'x')).strength(0.14))
    .force('y', d3.forceY((d) => sectorTarget(d, 'y')).strength(0.14))
    .stop();

  // Deterministic settle: D3 seeds positions on a phyllotaxis spiral and the
  // forces are noise-free, so the same data always lands in the same map —
  // spatial memory across visits.
  for (let i = 0; i < SETTLE_TICKS; i++) simulation.tick();

  // Anchored default positions: store home, swap centering for anchor forces.
  for (const n of graph.nodes) {
    n.homeX = n.x;
    n.homeY = n.y;
  }

  // §4c persistence: dragged-and-snapped positions survive reloads
  // (per-browser). "Reset layout" clears them.
  const saved = loadSavedLayout();
  for (const n of graph.nodes) {
    if (Array.isArray(saved[n.id])) {
      n.homeX = n.x = n.fx = saved[n.id][0];
      n.homeY = n.y = n.fy = saved[n.id][1];
    }
  }

  // §6a.1 orbital layout: children take fixed angular slots around their
  // parent at a computed radius (solar-system style), replacing the old
  // convex-hull blob. Slots are assigned by each child's settled angle so
  // nothing travels far; a user's own saved placement outranks its slot.
  for (const fam of families) {
    // The parent is the ring's center — pin it so the re-settle can't drift
    // it off the orbit its children are slotted around.
    fam.parent.fx = fam.parent.homeX;
    fam.parent.fy = fam.parent.homeY;
    const slots = orbitalSlots(
      { x: fam.parent.homeX, y: fam.parent.homeY },
      fam.children,
      fam.radius
    );
    for (const child of fam.children) {
      if (Array.isArray(saved[child.id])) continue;
      const slot = slots.get(child.id);
      child.orbital = true;
      // Slots are FIXED (§6a.1): pin children like snapped nodes, so their
      // own satellite links can't tug them off the orbit. Dragging still
      // works — the drag handler overrides fx/fy for its duration.
      child.homeX = child.x = child.fx = slot.x;
      child.homeY = child.y = child.fy = slot.y;
    }
  }

  simulation
    .force('x', d3.forceX((d) => d.homeX).strength((d) => (d.orbital ? 0.7 : ANCHOR_STRENGTH)))
    .force('y', d3.forceY((d) => d.homeY).strength((d) => (d.orbital ? 0.7 : ANCHOR_STRENGTH)));

  // Re-settle so each relocated child's own satellites follow it to the new
  // slot, then freeze those equilibria as the free nodes' homes. Full settle
  // length: the wider orbits displace a lot of neighbors.
  simulation.alpha(0.6);
  for (let i = 0; i < SETTLE_TICKS; i++) simulation.tick();

  // Relaxation pass: run ONLY the label-collide constraint for a few dozen
  // iterations. During the force settle, a free node squeezed between pinned
  // orbit boxes and its own link tension can oscillate instead of escaping —
  // with the opposing forces silenced, boxes separate fully.
  const relaxExclusion = forceOrbitExclusion(families);
  relaxExclusion.initialize(graph.nodes);
  const relax = forceLabelCollide();
  relax.initialize(graph.nodes);
  for (let i = 0; i < 80; i++) {
    relaxExclusion();
    relax();
  }

  for (const n of graph.nodes) {
    if (!n.orbital && !Array.isArray(saved[n.id])) {
      n.homeX = n.x;
      n.homeY = n.y;
    }
  }
  simulation.alpha(0);

  /* §4f sector boundaries: faint grid lines + corner labels, no fills —
     node fill color already carries relevance/identity meaning (§5/§5a). */
  sectorLayer
    .selectAll('line.sector-v')
    .data([0, 1, 2, 3])
    .join('line')
    .attr('class', 'sector-line sector-v')
    .attr('x1', (i) => gridX0 + i * SECTOR_W)
    .attr('x2', (i) => gridX0 + i * SECTOR_W)
    .attr('y1', gridY0)
    .attr('y2', gridY0 + 2 * SECTOR_H);
  sectorLayer
    .selectAll('line.sector-h')
    .data([0, 1, 2])
    .join('line')
    .attr('class', 'sector-line sector-h')
    .attr('x1', gridX0)
    .attr('x2', gridX0 + 3 * SECTOR_W)
    .attr('y1', (i) => gridY0 + i * SECTOR_H)
    .attr('y2', (i) => gridY0 + i * SECTOR_H);
  sectorLayer
    .selectAll('text')
    .data(SECTORS)
    .join('text')
    .attr('class', 'sector-label')
    .attr('x', (s) => gridX0 + s.col * SECTOR_W + 16)
    .attr('y', (s) => gridY0 + s.row * SECTOR_H + 28)
    .text((s) => s.label);

  /* dashed orbit paths behind the children (§6a.1, optional rendering) */
  const orbits = hullLayer
    .selectAll('circle')
    .data(families)
    .join('circle')
    .attr('class', 'orbit-path')
    .attr('r', (d) => d.radius);

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
        .text(ring === 'signal' ? 'SIGNAL' : ring === 'rfp' ? 'RFP' : 'NEW');
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

  // Default view = the whole settled map, fit with padding. Reset returns here.
  function fitTransform() {
    const pad = 60;
    const nx = d3.extent(graph.nodes, (d) => d.homeX);
    const ny = d3.extent(graph.nodes, (d) => d.homeY);
    // Include the sector grid so empty sectors (Sports, CPGs) stay on-chart.
    const xs = [Math.min(nx[0], gridX0), Math.max(nx[1], gridX0 + 3 * SECTOR_W)];
    const ys = [Math.min(ny[0], gridY0), Math.max(ny[1], gridY0 + 2 * SECTOR_H)];
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

  /* lens toggle: visibility treatment only — nodes never move (Section 4) */
  document.querySelectorAll('#lens-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#lens-toggle button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.lens = btn.dataset.lens;
      applyLens();
    });
  });

  function applyLens() {
    node.classed('dimmed', (d) => !inLens(d, state.lens));
    link.classed(
      'dimmed',
      (d) => !inLens(d.source, state.lens) || !inLens(d.target, state.lens)
    );
    orbits.classed(
      'dimmed',
      (d) => ![d.parent, ...d.children].some((m) => inLens(m, state.lens))
    );
  }

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
    updateAnalogLines();
    showPanel(d);
  }

  function clearSelection() {
    state.selected = null;
    node.classed('selected', false).classed('analog-partner', false);
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

  applyLens();

  // Debug hook for force-tuning sessions (harmless in production).
  window.__cluster = { state, simulation };
}

/* --------------------------------------- orbit exclusion force (6a.1a) */

/**
 * Each family's orbit disc is an exclusion zone (§6a.1a): a non-family node
 * sitting inside the ring falsely reads as affiliated with the parent
 * (Twisted Tea inside the MABI orbit). Treat the orbit as a fixed circular
 * obstacle — any outside node that strays within it gets pushed radially out
 * to the boundary. Center follows the parent's LIVE position, so the zone
 * moves with a dragged parent. One zone per family; pinned nodes (orbit
 * slots, user placements) are never moved — same rule as label collide.
 */
function forceOrbitExclusion(families) {
  let nodes;

  function force() {
    for (const fam of families) {
      const cx = fam.parent.x;
      const cy = fam.parent.y;
      const familyIds = new Set([fam.parent.id, ...fam.children.map((c) => c.id)]);
      for (const n of nodes) {
        if (n.fx != null || familyIds.has(n.id)) continue;
        const out = radialEscape(n.x, n.y, cx, cy, fam.radius + n.r + 12);
        if (out) {
          n.x = out.x;
          n.y = out.y;
        }
      }
    }
  }

  force.initialize = (n) => (nodes = n);
  return force;
}

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
function forceLabelCollide() {
  let nodes;
  const strength = 0.5;

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
        const aFree = a.fx == null;
        const bFree = b.fx == null;
        if (!aFree && !bFree) continue; // both pinned/dragged — leave them
        if (aFree && bFree) {
          // Both movable: split the push along the axis of least overlap.
          if (ox < oy) {
            const push = ox * 0.5 * strength * (b.x > a.x ? 1 : -1);
            a.x -= push;
            b.x += push;
          } else {
            const push = oy * 0.5 * strength * (by > ay ? 1 : -1);
            a.y -= push;
            b.y += push;
          }
        } else {
          // One side is pinned (orbit slot / user placement): push the free
          // node RADIALLY away from the pinned box. Axis pushes cancel when a
          // node is squeezed in the corridor between two pinned boxes;
          // radial pushes compose outward and let it escape.
          const free = aFree ? a : b;
          const pin = aFree ? b : a;
          let vx = free.x - pin.x;
          let vy = free.y + free.boxCy - (pin.y + pin.boxCy);
          const len = Math.hypot(vx, vy) || 1;
          const push = Math.min(ox, oy) * strength;
          free.x += (vx / len) * push;
          free.y += (vy / len) * push;
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
      // Occupancy: every other node's home claims its containing cell, so two
      // nodes can never land on the same spot (§4c fallback rule).
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
      // Dragging a parent moves its orbit with it: children still in their
      // slots (not individually placed by the user) keep formation. Their
      // homes are derived from the parent's, so only the parent is saved.
      if (d.type === 'parent') {
        const fam = families.find((f) => f.parent === d);
        const savedNow = loadSavedLayout();
        for (const child of fam?.children || []) {
          if (Array.isArray(savedNow[child.id])) continue;
          child.homeX += dx;
          child.homeY += dy;
          // Glide the child's pin to its new slot alongside the parent's snap
          // tween — the alpha-scaled anchor alone stalls out on long moves.
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
      // d3.forceX/Y cache their target accessor at initialization — homes
      // just changed, so re-point the anchors or they pull at stale spots.
      simulation.force('x').x((n) => n.homeX);
      simulation.force('y').y((n) => n.homeY);
      // Placed nodes stay pinned to their cell (desktop-icon semantics) —
      // link tension must not drag them off it. Short tween so the snap
      // animates rather than teleporting.
      const from = { x: event.x, y: event.y };
      d3.select({}).transition().duration(220).ease(d3.easeCubicOut).tween('snap', () => (t) => {
        d.fx = from.x + (cell.x - from.x) * t;
        d.fy = from.y + (cell.y - from.y) * t;
      });
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
  const sector = SECTORS.find((s) => s.id === d.sector);
  if (sector) sub.push(esc(sector.label));
  parts.push(`<div class="subtitle">${sub.join(' · ')}</div>`);

  const badges = [];
  if (d.is_g7_client) badges.push('<span class="badge client">G7 CLIENT</span>');
  if (d.zone) badges.push(`<span class="badge zone">${esc(d.zone.toUpperCase())}</span>`);
  if (d.rings?.includes('signal')) badges.push('<span class="badge signal">SIGNAL STACKS</span>');
  if (d.rings?.includes('rfp')) badges.push('<span class="badge rfp">RFP</span>');
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

  panelContent.innerHTML = parts.join('');
  panel.classList.remove('hidden');
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
