/**
 * Cluster Study Map Engine v2 — vertical taxonomies + weighted positioning
 * (Plan Part II, §II.1–II.2).
 *
 * Every hub entity carries TWO scored profiles — business_verticals (what it
 * sells) and cultural_verticals (how it behaves as a marketer) — each a 0–5
 * score against EVERY vertical in that taxonomy. Scores display as 0–5 and
 * compute as normalized 0–100% weights. An entity's position on a map is the
 * weighted average of that map's fixed well anchors.
 *
 * BOTH taxonomies are explicitly provisional (II.10): everything downstream
 * is data-driven from these two arrays, so revising a list is an edit here —
 * never a math or rendering change.
 */

export const BUSINESS_VERTICALS = [
  { id: 'food_beverage', label: 'Food & Beverage' },
  { id: 'automotive_transportation', label: 'Automotive & Transportation' },
  { id: 'technology_b2b', label: 'Technology & B2B' },
  { id: 'cpgs', label: 'CPGs' },
  { id: 'sports', label: 'Sports' },
  { id: 'hospitality_travel_tourism', label: 'Hospitality / Travel / Tourism' },
];

// NOTE: the plan (II.10) and seed _meta both say "11 wells" but enumerate 12.
// Implementing the 12 enumerated slugs — flagged for reconciliation; trimming
// one later is a one-line edit here.
export const CULTURAL_VERTICALS = [
  { id: 'music_performance', label: 'Music (Performance)' },
  { id: 'sports', label: 'Sports' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'festival', label: 'Festival' },
  { id: 'talent_celebrity_partnerships', label: 'Talent & Celebrity Partnerships' },
  { id: 'film_tv_inclusion', label: 'Film & Television Inclusion' },
  { id: 'college_marketing', label: 'College Marketing' },
  { id: 'outdoor_adventure', label: 'Outdoor & Adventure' },
  { id: 'inter_brand_collaborations', label: 'Inter-Brand Collaborations' },
  { id: 'creator_influencer_partnerships', label: 'Creator & Influencer Partnerships' },
  { id: 'wellness_fitness', label: 'Wellness & Fitness' },
];

/**
 * 0–5 display scores → normalized weights summing to 1 (II.1 storage rule).
 * Unknown vertical ids are ignored; returns null when nothing scores > 0.
 */
export function normalizeScores(scores, taxonomy) {
  if (!scores) return null;
  let total = 0;
  const clean = {};
  for (const v of taxonomy) {
    const s = Math.max(0, Math.min(5, Number(scores[v.id]) || 0));
    if (s > 0) {
      clean[v.id] = s;
      total += s;
    }
  }
  if (total === 0) return null;
  for (const id in clean) clean[id] /= total;
  return clean;
}

/**
 * II.2 position rule: weighted average of the map's fixed well anchors.
 * `anchors` is a Map or plain object of vertical id -> {x, y}.
 * Returns null when the entity has no usable weights for this map.
 */
export function weightedPosition(weights, anchors) {
  if (!weights) return null;
  let x = 0;
  let y = 0;
  let used = 0;
  for (const [id, w] of Object.entries(weights)) {
    const a = anchors instanceof Map ? anchors.get(id) : anchors[id];
    if (!a) continue;
    x += a.x * w;
    y += a.y * w;
    used += w;
  }
  if (used === 0) return null;
  return { x: x / used, y: y / used };
}

/** II.4 parent position rule (adopted early, position only): child centroid. */
export function centroid(points) {
  const pts = (points || []).filter(Boolean);
  if (!pts.length) return null;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/* ---------------- PROVISIONAL STUB SCORES — phase-1 placeholder ---------- */
/*
 * The 15 hub nodes have NOT been re-scored against the II.1 schema yet (seed
 * _meta confirms). Until that data-entry pass happens, each hub gets its old
 * single vertical at 5 plus ROUGH derived secondaries inferred ONLY from
 * existing seed data (zone, category text, g7_notes) — per user decision, to
 * avoid the degenerate everything-stacked-on-one-anchor layout the pure stub
 * would produce. Derivation rationale is noted per line.
 *
 * >>> THESE ARE PLACEHOLDERS, NOT REAL SCORING. Replace wholesale when the
 * >>> real multi-vertical scoring pass lands. Seed-supplied
 * >>> business_verticals / cultural_verticals fields always take precedence.
 */
export const STUB_SCORES = {
  white_claw: { business: {}, cultural: { talent_celebrity_partnerships: 3, music_performance: 2, festival: 2 } }, // combo zone; talent-booking history in notes
  liquid_death: { business: {}, cultural: { inter_brand_collaborations: 2, music_performance: 2 } }, // "edgy-branded" category, energy expansion
  fireball_whiskey: { business: {}, cultural: { festival: 2, music_performance: 2 } }, // nightlife/shot-occasion category
  ram_trucks: { business: {}, cultural: { outdoor_adventure: 3, sports: 2 } }, // rugged-lifestyle adjacencies (Yeti, Carhartt)
  turbotax_intuit: { business: {}, cultural: { talent_celebrity_partnerships: 3, creator_influencer_partnerships: 2 } }, // talent-on-economic-fluency note
  atlassian: { business: {}, cultural: { talent_celebrity_partnerships: 2 } }, // Talent zone (conference booking)
  subaru: { business: {}, cultural: { outdoor_adventure: 4, sports: 2, festival: 1 } }, // outdoor/overlanding notes
  lagunitas: { business: {}, cultural: { music_performance: 2, festival: 2 } }, // experiential programs note
  jackson_hole: { business: { sports: 2 }, cultural: { festival: 5, music_performance: 5, outdoor_adventure: 4, talent_celebrity_partnerships: 3, sports: 2 } }, // Rendezvous Music Festival end-to-end
  workday: { business: {}, cultural: { talent_celebrity_partnerships: 2 } }, // Talent zone
  cisco: { business: {}, cultural: { talent_celebrity_partnerships: 2 } }, // Talent zone
  mikes_hard_lemonade: { business: {}, cultural: { festival: 2, music_performance: 1 } }, // MABI experiential
  cayman_jack: { business: {}, cultural: { festival: 2 } }, // MABI experiential
  ole: { business: {}, cultural: { festival: 1 } }, // MABI experiential (newest)
  mojo_energy: { business: {}, cultural: { sports: 2, wellness_fitness: 2, gaming: 1 } }, // energy/caffeine-pouch category
};

/** Build the two scored objects for a hub that lacks them (stub path). */
export function stubVerticalScores(hub) {
  const stub = STUB_SCORES[hub.id] || { business: {}, cultural: {} };
  const business = { ...stub.business };
  if (hub.vertical) business[hub.vertical] = 5; // old single assignment = dominant 5
  return {
    business_verticals: business,
    cultural_verticals: { ...stub.cultural },
  };
}

/** v1 frontend sector ids (carried by CSV/generated nodes) → v2 business ids. */
export const LEGACY_SECTOR_TO_BUSINESS = {
  food_beverage: 'food_beverage',
  automotive: 'automotive_transportation',
  tech_b2b: 'technology_b2b',
  cpg: 'cpgs',
  sports: 'sports',
  hospitality: 'hospitality_travel_tourism',
};
