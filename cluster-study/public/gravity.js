/**
 * Cluster Study — G7 Gravity score (Plan II.7).
 *
 * A computed 0–100 "how strategically relevant, commercially plausible, and
 * timely is this company for G7 right now" score, shown in the click-through
 * panel with a factor breakdown. Shared ES module (browser + tests), no deps.
 *
 * FORMULA STATUS: explicitly a first draft, not a launch commitment (II.7).
 * The weights below are the plan's proposed starting split, logged for tuning
 * against real outcomes. Several inputs are PROXIES until their real data
 * sources exist — each factor carries a `basis` string saying exactly what
 * fed it, so nobody mistakes a placeholder for a measurement:
 *   - capability fit      ← cultural-profile depth (CAP will own this, Part III)
 *   - recent momentum     ← live signal relevance (real, from Signal Stacks)
 *   - commercial potential← NO DATA yet (revenue figures, Plan §7.2) — neutral
 *   - relationship access ← client / sister-agency / corporate-family flags (real)
 *   - lookalike strength  ← structural-analog pairs (real but sparse)
 *   - opportunity timing  ← signal arrow decay level (real)
 *   - constraint penalty  ← COI flag only; entrenched-agency and procurement
 *                           friction have no data source yet
 */

import { arrowDecayLevel, ARROW_MAX_LEVELS } from './scoring.js';

/** II.7 first-draft weights (points of the 100 each factor can contribute). */
export const GRAVITY_WEIGHTS = {
  capability_fit: 25,
  recent_momentum: 20,
  commercial_potential: 15,
  relationship_access: 15,
  lookalike_strength: 10,
  opportunity_timing: 15,
};
export const GRAVITY_MAX_PENALTY = 25;

const FACTOR_LABELS = {
  capability_fit: 'Capability fit',
  recent_momentum: 'Recent momentum',
  commercial_potential: 'Commercial potential',
  relationship_access: 'Relationship access',
  lookalike_strength: 'Lookalike strength',
  opportunity_timing: 'Opportunity timing',
};

/**
 * Compute the G7 Gravity score for one node.
 *
 * ctx: {
 *   relevance:       0–1 effective relevance (own or propagated signal), or 0
 *   inClientFamily:  node's corporate family contains a G7 client
 *   hasAnalog:       node appears in a structural_analogs pair
 * }
 *
 * Returns { score, factors: [{id, label, weight, value, points, basis}],
 *           penalties: [{id, label, points, basis}], trend: {dir, driver} }.
 */
export function computeGravity(node, ctx, nowMs) {
  const factors = [];
  const add = (id, value, basis) => {
    const weight = GRAVITY_WEIGHTS[id];
    const v = Math.max(0, Math.min(1, value));
    factors.push({ id, label: FACTOR_LABELS[id], weight, value: v, points: weight * v, basis });
  };

  // Capability fit — proxy: depth of the cultural profile (mean of the top
  // two 0–5 scores). A brand already behaving culturally is a fit for a
  // culture-marketing agency. CAP's Established Affinity replaces this.
  const cultScores = Object.values(node.cultural_verticals || {})
    .map(Number)
    .filter((s) => s > 0)
    .sort((a, b) => b - a);
  if (cultScores.length) {
    const top2 = (cultScores[0] + (cultScores[1] ?? cultScores[0])) / 2;
    add('capability_fit', top2 / 5, `top cultural scores ${cultScores.slice(0, 2).join('/')} of 5 (proxy until CAP)`);
  } else {
    add('capability_fit', 0.3, 'unscored entity — placeholder midpoint (proxy until CAP)');
  }

  // Recent momentum — real input: strength × recency decay, propagation
  // included, exactly what the map's gray glow already encodes.
  const rel = Math.max(0, Math.min(1, ctx.relevance || 0));
  add('recent_momentum', rel, rel > 0 ? `live signal relevance ${Math.round(rel * 100)}%` : 'no live signal');

  // Commercial potential — no revenue/project-volume data yet (Plan §7.2
  // blocks the Leadership view on the same gap). Neutral until sourced.
  add('commercial_potential', 0.5, 'no revenue data yet — neutral default');

  // Relationship access — real flags, ranked by directness.
  if (node.is_g7_client) add('relationship_access', 1, 'existing G7 client');
  else if (node.sister_agency) add('relationship_access', 0.85, 'Project Worldwide sister-agency client');
  else if (ctx.inClientFamily) add('relationship_access', 0.6, 'corporate family includes a G7 client');
  else add('relationship_access', 0.2, 'no known relationship path');

  // Lookalike strength — structural-analog pairs are the only lookalike
  // signal wired in so far (RFP-lookalike matches will feed this too).
  add(
    'lookalike_strength',
    ctx.hasAnalog ? 0.75 : 0.25,
    ctx.hasAnalog ? 'structurally analogous to a G7 client' : 'no structural analog on record'
  );

  // Opportunity timing — how fresh the window is: the signal arrow's decay
  // level (0 = this month) mapped linearly onto 1 → 1/6.
  const level = arrowDecayLevel(node.signal, nowMs);
  if (level !== null) {
    add('opportunity_timing', 1 - level / ARROW_MAX_LEVELS, `signal in decay month ${level + 1} of ${ARROW_MAX_LEVELS}`);
  } else {
    add('opportunity_timing', 0.15, 'no signal inside the 24-week window');
  }

  // Constraint penalty — COI is the only wired flag; entrenched-agency and
  // procurement-friction penalties await data sources (II.7).
  const penalties = [];
  if (node.coi_sensitive) {
    penalties.push({ id: 'coi', label: 'Conflict-of-interest exposure', points: 15, basis: 'coi_sensitive flag' });
  }
  const penaltyTotal = Math.min(
    GRAVITY_MAX_PENALTY,
    penalties.reduce((s, p) => s + p.points, 0)
  );

  const raw = factors.reduce((s, f) => s + f.points, 0) - penaltyTotal;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // Trend — honest placeholder: real rising/stable/falling needs score
  // history that doesn't exist yet. A fresh signal (first two decay months)
  // reads as rising; everything else stable.
  const trend =
    level !== null && level <= 1
      ? { dir: 'rising', driver: 'fresh signal inside 8 weeks' }
      : { dir: 'stable', driver: 'no recent movement on record (history-based trend pending)' };

  return { score, factors, penalties, penaltyTotal, trend };
}
