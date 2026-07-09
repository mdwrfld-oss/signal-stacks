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

const svg = d3.select('#canvas');
const statusEl = document.getElementById('status');
const panel = document.getElementById('detail-panel');
const panelContent = document.getElementById('panel-content');

const SETTLE_TICKS = 300;
const ANCHOR_STRENGTH = 0.22;
const RING_LABEL_ZOOM = 2.2; // rings separate + labels become viable past here
const ADJ_LABEL_ZOOM = 0.85;

const RADII = { hub: 16, parent: 13, adjacent: 8 };
const RING_GAP = 4;

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

const fillScale = d3.interpolateRgb('#e8e0f7', '#3a1d6e');

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

  for (const n of graph.nodes) {
    n.r = RADII[n.type] || RADII.adjacent;
    n.rings = ringsFor(n, now, state.config);
    const eff = state.effective.get(n.id);
    n.relevance = eff ? eff.relevance : 0;
    n.floor = !n.signal && !eff;
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

  // Structural analogs stay OUT of the layout links: not physical proximity,
  // not a persistent line (Section 6a.7).
  const layoutLinks = graph.links.map((l) => ({ ...l }));

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force(
      'link',
      d3
        .forceLink(layoutLinks)
        .id((d) => d.id)
        .distance((d) =>
          d.relationship === 'parent_of' ? 55 : d.relationship === 'direct_competitor' ? 75 : 100
        )
        .strength((d) =>
          d.relationship === 'parent_of' ? 0.9 : d.relationship === 'direct_competitor' ? 0.5 : 0.3
        )
    )
    .force(
      'charge',
      d3.forceManyBody().strength((d) => (d.type === 'hub' ? -320 : d.type === 'parent' ? -260 : -110))
    )
    .force('collide', d3.forceCollide((d) => d.r + 8))
    .force('x', d3.forceX(width / 2).strength(0.06))
    .force('y', d3.forceY(height / 2).strength(0.06))
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
  simulation
    .force('x', d3.forceX((d) => d.homeX).strength(ANCHOR_STRENGTH))
    .force('y', d3.forceY((d) => d.homeY).strength(ANCHOR_STRENGTH))
    .alpha(0);

  /* hulls — one per corporate parent with members (Section 6a.1) */
  const families = buildFamilies(graph);
  const hulls = hullLayer
    .selectAll('path')
    .data(families)
    .join('path')
    .attr('class', 'hull');
  const hullLabels = hullLayer
    .selectAll('text')
    .data(families)
    .join('text')
    .attr('class', 'hull-label')
    .text((d) => d.parent.name);

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
    .call(dragBehavior(simulation))
    .on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d);
    });

  node
    .append('circle')
    .attr('class', 'core')
    .attr('r', (d) => d.r)
    .attr('fill', (d) => (d.floor ? 'var(--floor-gray)' : fillScale(Math.max(0.06, d.relevance))));

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
    const xs = d3.extent(graph.nodes, (d) => d.homeX);
    const ys = d3.extent(graph.nodes, (d) => d.homeY);
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
  svg.call(zoom.transform, fitTransform());

  /* tick — also runs during drags so hulls and links track live (4b) */
  function ticked() {
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);
    hulls.attr('d', (d) => hullPath(d.members));
    hullLabels
      .attr('x', (d) => d3.mean(d.members, (m) => m.x))
      .attr('y', (d) => d3.min(d.members, (m) => m.y - m.r) - 14);
    updateAnalogLines();
  }
  simulation.on('tick', ticked);
  ticked();

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
    hulls.classed('dimmed', (d) => !d.members.some((m) => inLens(m, state.lens)));
    hullLabels.classed('dimmed', (d) => !d.members.some((m) => inLens(m, state.lens)));
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

/* ------------------------------------------------------------ drag (4b) */

function dragBehavior(simulation) {
  // Grab, rearrange, release: neighbors respond through the live forces, and
  // the anchor force eases everything back home on release — temporary
  // decluttering without permanently disrupting the shared layout.
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
      d.fx = null;
      d.fy = null;
      // one gentle reheat so the anchor force can walk everyone home
      simulation.alpha(0.3).restart();
    });
}

/* ----------------------------------------------------------------- hulls */

function buildFamilies(graph) {
  const families = [];
  for (const parent of graph.nodes.filter((n) => n.type === 'parent')) {
    const members = [parent, ...graph.nodes.filter((n) => n.parent === parent.id)];
    if (members.length >= 2) families.push({ parent, members });
  }
  return families;
}

function hullPath(members) {
  // Pad each member with satellite points so the hull wraps circles, not centers.
  const pts = [];
  for (const m of members) {
    const pad = m.r + 14;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      pts.push([m.x + pad * Math.cos(a), m.y + pad * Math.sin(a)]);
    }
  }
  const hull = d3.polygonHull(pts);
  if (!hull) return '';
  return `M${hull.join('L')}Z`;
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
  if (d.zone) badges.push(`<span class="badge zone">${esc(d.zone.toUpperCase())}</span>`);
  if (d.rings?.includes('signal')) badges.push('<span class="badge signal">SIGNAL STACKS</span>');
  if (d.rings?.includes('rfp')) badges.push('<span class="badge rfp">RFP</span>');
  if (d.coi_sensitive) badges.push('<span class="badge coi">COI-SENSITIVE</span>');
  if (badges.length) parts.push(`<p>${badges.join(' ')}</p>`);

  /* relevance / signal state */
  parts.push('<h3>Signal</h3>');
  if (d.floor) {
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
