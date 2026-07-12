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

// Taxonomies match the seed's scored objects exactly (all 19 entities carry
// every key). 9 business wells — beauty_retail, media_social_platforms, and
// entertainment are new vs. the original 6. 13 cultural wells — the earlier
// film_tv_inclusion split into film_tv + inclusion.
export const BUSINESS_VERTICALS = [
  { id: 'food_beverage', label: 'Food & Beverage' },
  { id: 'automotive_transportation', label: 'Automotive & Transportation' },
  { id: 'technology_b2b', label: 'Technology & B2B' },
  { id: 'cpgs', label: 'CPGs' },
  { id: 'sports', label: 'Sports' },
  { id: 'hospitality_travel_tourism', label: 'Hospitality / Travel / Tourism' },
  { id: 'beauty_retail', label: 'Beauty & Retail' },
  { id: 'media_social_platforms', label: 'Media & Social Platforms' },
  { id: 'entertainment', label: 'Entertainment' },
];

export const CULTURAL_VERTICALS = [
  { id: 'music_performance', label: 'Music (Performance)' },
  { id: 'sports', label: 'Sports' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'festival', label: 'Festival' },
  { id: 'talent_celebrity_partnerships', label: 'Talent & Celebrity' },
  { id: 'film_tv', label: 'Film & TV' },
  { id: 'inclusion', label: 'Inclusion' },
  { id: 'college_marketing', label: 'College Marketing' },
  { id: 'outdoor_adventure', label: 'Outdoor & Adventure' },
  { id: 'inter_brand_collaborations', label: 'Inter-Brand Collabs' },
  { id: 'creator_influencer_partnerships', label: 'Creator & Influencer' },
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

/** v1 frontend sector ids (carried by CSV/generated nodes) → v2 business ids. */
export const LEGACY_SECTOR_TO_BUSINESS = {
  food_beverage: 'food_beverage',
  automotive: 'automotive_transportation',
  tech_b2b: 'technology_b2b',
  cpg: 'cpgs',
  sports: 'sports',
  hospitality: 'hospitality_travel_tourism',
};
