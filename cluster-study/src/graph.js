/**
 * Cluster Study — graph builders.
 *
 * Turns the two data sources (the seed JSON bootstrap and the NBD-maintained
 * Google Sheet) into one graph shape the frontend consumes:
 *
 * {
 *   generated, source, config,
 *   nodes: [{ id, name, type: hub|adjacent|parent, category, zone, parent,
 *             confidence, g7_notes, signal, date_added, source }],
 *   links: [{ source, target, relationship, note }]
 * }
 *
 * Relationship types: direct_competitor | analogous_audience | parent_of.
 * (structural_analog and the coi_sensitive/coi_note fields were removed
 * 2026-07-20 — see the seed _meta notes and plan doc II.15.)
 */

import { DEFAULT_CONFIG } from '../public/scoring.js';

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function baseGraph(source) {
  return {
    generated: new Date().toISOString(),
    source,
    config: { ...DEFAULT_CONFIG },
    nodes: [],
    links: [],
  };
}

/**
 * Build the graph from the manual seed-data bootstrap
 * (G7_Cluster_Study_Seed_Data.json). Seed nodes are permanent floor-state
 * nodes — no ring, no decay — until Signal Stacks lights them up later
 * (Section 11 bootstrap rationale).
 *
 * Adjacent brands shared across hubs (Yeti, Surfside, ...) dedupe into a
 * single node connected to every relevant hub — resolved open question #1.
 */
export function buildGraphFromSeed(seed) {
  const graph = baseGraph('seed');
  const nodesById = new Map();

  const upsert = (node) => {
    const existing = nodesById.get(node.id);
    if (!existing) {
      nodesById.set(node.id, node);
      return node;
    }
    // Hubs/parents win over adjacent stubs if the same brand shows up twice.
    if (existing.type === 'adjacent' && node.type !== 'adjacent') {
      nodesById.set(node.id, { ...node, ...pickSignal(existing, node) });
      return nodesById.get(node.id);
    }
    return existing;
  };

  for (const hub of seed.hub_nodes || []) {
    // II.1: two complete scored profiles per hub, straight from the seed.
    // (The old single `vertical` string and the phase-1 stub scoring are
    // gone — the seed's scoring pass is the source of truth.)
    upsert({
      id: hub.id,
      name: hub.name,
      type: 'hub',
      category: hub.category || null,
      zone: hub.zone || null,
      parent: null,
      business_verticals: hub.business_verticals || null,
      cultural_verticals: hub.cultural_verticals || null,
      // Per-category rubric objects (Historical Depth, Recurrence, … Sources) for
      // the panel's rubric accordion. Data-only for now — carried through so it's
      // present when the accordion is wired; not yet read by any renderer.
      cultural_rubric: hub.cultural_rubric || null,
      // Human corrections to vertical scores, keyed by field path. Non-destructive
      // (the researched values above are never touched). Seeded corrections are
      // rare; the live path is the overlay merged at /data read time.
      manual_overrides: hub.manual_overrides || null,
      is_g7_client: !!hub.is_g7_client,
      sister_agency: hub.sister_agency === true,
      confidence: hub.confidence || null,
      g7_notes: hub.g7_notes || null,
      signal: null,
      date_added: null,
      source: 'seed',
    });

    for (const adj of hub.adjacent || []) {
      const adjId = slugify(adj.name);
      upsert({
        id: adjId,
        name: adj.name,
        type: 'adjacent',
        category: null,
        zone: null,
        parent: null,
        is_g7_client: false,
        sister_agency: false,
        confidence: null,
        g7_notes: null,
        signal: null,
        date_added: null,
        source: 'seed',
      });
      graph.links.push({
        source: hub.id,
        target: adjId,
        relationship: adj.relationship,
        note: adj.note || '',
      });
    }
  }

  for (const parent of seed.corporate_parents || []) {
    upsert({
      id: parent.id,
      name: parent.name,
      type: 'parent',
      category: null,
      zone: null,
      parent: null,
      // §5a: corporate parents that aren't themselves direct clients stay
      // floor-gray; the seed only sets is_g7_client on hub nodes.
      is_g7_client: !!parent.is_g7_client,
      sister_agency: parent.sister_agency === true,
      confidence: parent.confidence || null,
      g7_notes: parent.note ? { relationship_notes: parent.note } : null,
      signal: null,
      date_added: null,
      source: 'seed',
    });
    for (const childId of parent.children_existing_hub_nodes || []) {
      const child = nodesById.get(childId);
      if (child) child.parent = parent.id;
      graph.links.push({
        source: parent.id,
        target: childId,
        relationship: 'parent_of',
        note: '',
      });
    }
  }

  graph.nodes = [...nodesById.values()];
  return graph;
}

function pickSignal(a, b) {
  return { signal: a.signal || b.signal || null };
}

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'x']);
const parseBool = (v) => TRUTHY.has(String(v || '').trim().toLowerCase());

/**
 * Build the graph from Sheet rows (Section 7 update / Section 8).
 *
 * Nodes tab columns (locked header row, case-insensitive):
 *   id, name, type (hub|adjacent|parent), category, zone (experiential|talent|combo),
 *   parent, notes, signal_strength (0-1), signal_date (YYYY-MM-DD),
 *   signal_type (signal_stacks|rfp), date_added, confidence
 * Relationships tab columns:
 *   source, target, relationship, note
 *
 * Propagation strength is computed algorithmically (scoring.js), not stored
 * per row.
 */
export function buildGraphFromSheet(nodeRows, relRows) {
  const graph = baseGraph('sheet');
  const nodesById = new Map();

  for (const row of nodeRows || []) {
    const name = (row.name || '').trim();
    if (!name) continue;
    const id = (row.id || '').trim() || slugify(name);
    const strength = parseFloat(row.signal_strength);
    const signal =
      strength > 0 && (row.signal_date || '').trim()
        ? {
            strength: Math.min(1, strength),
            date: row.signal_date.trim(),
            type: (row.signal_type || 'signal_stacks').trim().toLowerCase(),
          }
        : null;
    nodesById.set(id, {
      id,
      name,
      type: (row.type || 'adjacent').trim().toLowerCase(),
      category: (row.category || '').trim() || null,
      zone: (row.zone || '').trim().toLowerCase() || null,
      parent: (row.parent || '').trim() || null,
      sector: (row.sector || '').trim().toLowerCase() || null,
      is_g7_client: parseBool(row.is_g7_client),
      sister_agency: parseBool(row.sister_agency),
      confidence: (row.confidence || '').trim() || null,
      g7_notes: (row.notes || '').trim() ? { relationship_notes: row.notes.trim() } : null,
      signal,
      date_added: (row.date_added || '').trim() || null,
      source: 'sheet',
    });
  }

  for (const row of relRows || []) {
    const source = (row.source || '').trim();
    const target = (row.target || '').trim();
    const relationship = (row.relationship || '').trim().toLowerCase();
    if (!source || !target || !relationship) continue;
    if (!nodesById.has(source) || !nodesById.has(target)) continue;
    if (relationship === 'parent_of') {
      const child = nodesById.get(target);
      if (child && !child.parent) child.parent = source;
    }
    graph.links.push({
      source,
      target,
      relationship,
      note: (row.note || '').trim(),
    });
  }

  // parent column on the Nodes tab also implies a parent_of link.
  for (const node of nodesById.values()) {
    if (!node.parent || !nodesById.has(node.parent)) continue;
    const exists = graph.links.some(
      (l) => l.relationship === 'parent_of' && l.source === node.parent && l.target === node.id
    );
    if (!exists) {
      graph.links.push({
        source: node.parent,
        target: node.id,
        relationship: 'parent_of',
        note: '',
      });
    }
  }

  graph.nodes = [...nodesById.values()];
  return graph;
}

/**
 * Merge the approved RFP-lookalike overlay (Section 6.1 step 6) into a base
 * graph. Overlay nodes never replace base nodes with the same id — the base
 * (Sheet/seed) is the source of truth; overlay links to existing nodes are kept.
 */
export function mergeOverlay(graph, overlay) {
  if (
    !overlay ||
    (!overlay.nodes?.length && !overlay.links?.length && !overlay.overrides)
  ) {
    return graph;
  }
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const node of overlay.nodes || []) {
    if (ids.has(node.id)) continue;
    ids.add(node.id);
    graph.nodes.push(node);
  }
  for (const link of overlay.links || []) {
    if (!ids.has(typeof link.source === 'object' ? link.source.id : link.source)) continue;
    if (!ids.has(typeof link.target === 'object' ? link.target.id : link.target)) continue;
    graph.links.push(link);
  }
  // Human corrections live entirely in the overlay so the researched base graph
  // is never mutated. Merge each node's { fieldPath: record } onto manual_overrides.
  if (overlay.overrides) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const [nodeId, fields] of Object.entries(overlay.overrides)) {
      const node = byId.get(nodeId);
      if (!node || !fields) continue;
      node.manual_overrides = { ...(node.manual_overrides || {}), ...fields };
    }
  }
  return graph;
}
