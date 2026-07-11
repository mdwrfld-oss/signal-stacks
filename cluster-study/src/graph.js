/**
 * Cluster Study — graph builders.
 *
 * Turns the two data sources (the seed JSON bootstrap and the NBD-maintained
 * Google Sheet) into one graph shape the frontend consumes:
 *
 * {
 *   generated, source, config,
 *   nodes: [{ id, name, type: hub|adjacent|parent, category, zone, parent,
 *             confidence, g7_notes, coi_sensitive, signal, date_added, source }],
 *   links: [{ source, target, relationship, note, coi_sensitive }],
 *   structural_analogs: [{ pair: [idA, idB], note }]
 * }
 *
 * Relationship types: direct_competitor | analogous_audience | parent_of.
 * Structural analogs are kept out of `links` on purpose — they render only
 * on selection (Section 6a.7), not as persistent edges or layout forces.
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
    structural_analogs: [],
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
    upsert({
      id: hub.id,
      name: hub.name,
      type: 'hub',
      category: hub.category || null,
      zone: hub.zone || null,
      parent: null,
      is_g7_client: !!hub.is_g7_client,
      sister_agency: hub.sister_agency === true,
      confidence: hub.confidence || null,
      g7_notes: hub.g7_notes || null,
      coi_sensitive: false,
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
        coi_sensitive: !!adj.coi_sensitive,
        signal: null,
        date_added: null,
        source: 'seed',
      });
      graph.links.push({
        source: hub.id,
        target: adjId,
        relationship: adj.relationship,
        note: adj.note || '',
        coi_sensitive: !!adj.coi_sensitive,
        coi_note: adj.coi_note || null,
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
      coi_sensitive: false,
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
        coi_sensitive: false,
      });
    }
  }

  for (const analog of seed.structural_analogs || []) {
    graph.structural_analogs.push({ pair: analog.pair, note: analog.note || '' });
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
 *   parent, coi_sensitive, notes, signal_strength (0-1), signal_date (YYYY-MM-DD),
 *   signal_type (signal_stacks|rfp), date_added, confidence
 * Relationships tab columns:
 *   source, target, relationship, note, coi_sensitive
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
      coi_sensitive: parseBool(row.coi_sensitive),
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
    if (relationship === 'structural_analog') {
      graph.structural_analogs.push({ pair: [source, target], note: (row.note || '').trim() });
      continue;
    }
    if (relationship === 'parent_of') {
      const child = nodesById.get(target);
      if (child && !child.parent) child.parent = source;
    }
    graph.links.push({
      source,
      target,
      relationship,
      note: (row.note || '').trim(),
      coi_sensitive: parseBool(row.coi_sensitive),
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
        coi_sensitive: false,
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
  if (!overlay || (!overlay.nodes?.length && !overlay.links?.length)) return graph;
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
  return graph;
}
