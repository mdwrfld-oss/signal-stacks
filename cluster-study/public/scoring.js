/**
 * Cluster Study — shared scoring math.
 *
 * Imported by both the Worker (src/graph.js, tests) and the browser
 * (public/app.js), so relevance and propagation are computed identically
 * everywhere. Keep this file dependency-free ES module.
 */

export const DEFAULT_CONFIG = {
  // Half-life for recency decay. Open question #12 in the plan — needs tuning
  // against real data; 6 weeks is the starting guess.
  half_life_days: 42,
  // New additions get a red ring for this many days (open question #11).
  new_addition_days: 7,
  // Section 6a.3 three-step propagation schema, capped at two hops.
  propagation_multipliers: [1.0, 0.5, 0.25],
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * relevance = signal_strength × recency_decay(days_since_signal)
 * Exponential falloff, halving every `half_life_days`. Nothing is hidden,
 * just de-emphasized (Section 5).
 */
export function relevance(signal, nowMs, config = DEFAULT_CONFIG) {
  if (!signal || !(signal.strength > 0) || !signal.date) return 0;
  const signalMs = Date.parse(signal.date);
  if (Number.isNaN(signalMs)) return 0;
  const days = Math.max(0, (nowMs - signalMs) / MS_PER_DAY);
  return signal.strength * Math.pow(0.5, days / config.half_life_days);
}

/**
 * Corporate-family neighbor map from parent_of links.
 * One "step" (Section 6a.3) = direct parent, direct child, OR sibling —
 * Kellogg's and Cheez-It are both step 1 from a Pringles signal.
 */
export function familySteps(links) {
  const children = new Map(); // parentId -> Set(childId)
  const parentOf = new Map(); // childId -> parentId
  for (const l of links) {
    if (l.relationship !== 'parent_of') continue;
    const p = typeof l.source === 'object' ? l.source.id : l.source;
    const c = typeof l.target === 'object' ? l.target.id : l.target;
    if (!children.has(p)) children.set(p, new Set());
    children.get(p).add(c);
    parentOf.set(c, p);
  }
  const neighbors = new Map(); // id -> Set(id), one propagation step away
  const add = (a, b) => {
    if (a === b) return;
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a).add(b);
  };
  for (const [p, kids] of children) {
    for (const c of kids) {
      add(p, c);
      add(c, p);
      for (const sib of kids) add(c, sib);
    }
  }
  return neighbors;
}

/**
 * Effective relevance per node: own relevance from a direct signal, plus
 * signal propagated through corporate structure (Section 6a.3):
 *   step 0 (the signal node itself) ×1.0, step 1 ×0.5, step 2 ×0.25,
 *   capped at two hops.
 *
 * Returns Map(id -> { relevance, hops, from }) where `hops` is 0 for a
 * direct signal and `from` names the node the signal propagated from.
 */
export function computeEffectiveRelevance(nodes, links, nowMs, config = DEFAULT_CONFIG) {
  const mult = config.propagation_multipliers || DEFAULT_CONFIG.propagation_multipliers;
  const maxHops = mult.length - 1;
  const neighbors = familySteps(links);
  const result = new Map();

  const consider = (id, value, hops, from) => {
    const prev = result.get(id);
    if (!prev || value > prev.relevance) {
      result.set(id, { relevance: value, hops, from });
    }
  };

  for (const node of nodes) {
    const own = relevance(node.signal, nowMs, config);
    if (own <= 0) continue;
    consider(node.id, own, 0, node.id);
    // BFS out through the corporate family, up to maxHops steps.
    let frontier = new Set([node.id]);
    const visited = new Set([node.id]);
    for (let step = 1; step <= maxHops; step++) {
      const next = new Set();
      for (const id of frontier) {
        for (const n of neighbors.get(id) || []) {
          if (visited.has(n)) continue;
          visited.add(n);
          next.add(n);
          consider(n, own * mult[step], step, node.id);
        }
      }
      frontier = next;
      if (frontier.size === 0) break;
    }
  }
  return result;
}

/** True when the node has never had any signal — the static floor state (Section 5). */
export function isFloorState(node, effective) {
  return !node.signal && !effective.has(node.id);
}

/** Ring types for a node (open question #9/#11): direct signals only for now (open question #13 stays open — inherited signals get fill, not rings). */
export function ringsFor(node, nowMs, config = DEFAULT_CONFIG) {
  const rings = [];
  if (node.signal && node.signal.type === 'signal_stacks') rings.push('signal');
  if (node.signal && node.signal.type === 'rfp') rings.push('rfp');
  if (node.date_added) {
    const addedMs = Date.parse(node.date_added);
    if (!Number.isNaN(addedMs) && (nowMs - addedMs) / MS_PER_DAY <= config.new_addition_days) {
      rings.push('new');
    }
  }
  return rings;
}
