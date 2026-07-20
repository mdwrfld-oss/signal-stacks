import { describe, it, expect } from 'vitest';
import { arrowDecayLevel, ARROW_LEVEL_DAYS, ARROW_MAX_LEVELS } from '../public/scoring.js';
import { computeGravity, GRAVITY_WEIGHTS, GRAVITY_MAX_PENALTY } from '../public/gravity.js';

const DAY = 86400000;
const NOW = Date.parse('2026-07-19T00:00:00Z');
const daysAgo = (d) => new Date(NOW - d * DAY).toISOString().split('T')[0];

describe('arrowDecayLevel (II.6: 4-week steps, 6 levels, 24-week window)', () => {
  it('steps down one level per 4 weeks', () => {
    expect(arrowDecayLevel({ date: daysAgo(0) }, NOW)).toBe(0);
    expect(arrowDecayLevel({ date: daysAgo(27) }, NOW)).toBe(0);
    expect(arrowDecayLevel({ date: daysAgo(28) }, NOW)).toBe(1);
    expect(arrowDecayLevel({ date: daysAgo(70) }, NOW)).toBe(2);
    expect(arrowDecayLevel({ date: daysAgo(5 * ARROW_LEVEL_DAYS) }, NOW)).toBe(5);
  });

  it('expires (null) at the 24-week boundary — a later recurrence is a fresh one-off', () => {
    expect(arrowDecayLevel({ date: daysAgo(ARROW_MAX_LEVELS * ARROW_LEVEL_DAYS) }, NOW)).toBeNull();
    expect(arrowDecayLevel({ date: daysAgo(400) }, NOW)).toBeNull();
  });

  it('handles missing/invalid/future dates safely', () => {
    expect(arrowDecayLevel(null, NOW)).toBeNull();
    expect(arrowDecayLevel({}, NOW)).toBeNull();
    expect(arrowDecayLevel({ date: 'not-a-date' }, NOW)).toBeNull();
    expect(arrowDecayLevel({ date: daysAgo(-3) }, NOW)).toBe(0); // clock skew → freshest
  });
});

describe('computeGravity (II.7 first draft)', () => {
  const base = { cultural_verticals: { sports: 4, festival: 2 } };
  const noCtx = { relevance: 0, inClientFamily: false, hasAnalog: false };

  it('weights sum to 100 and every factor reports a basis', () => {
    expect(Object.values(GRAVITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const g = computeGravity(base, noCtx, NOW);
    expect(g.factors).toHaveLength(6);
    for (const f of g.factors) {
      expect(f.basis).toBeTruthy();
      expect(f.points).toBeGreaterThanOrEqual(0);
      expect(f.points).toBeLessThanOrEqual(f.weight);
    }
  });

  it('capability fit reads the top-2 cultural scores (proxy)', () => {
    const g = computeGravity(base, noCtx, NOW);
    const cap = g.factors.find((f) => f.id === 'capability_fit');
    expect(cap.value).toBeCloseTo((4 + 2) / 2 / 5, 6); // 0.6
    expect(cap.basis).toMatch(/proxy/);
  });

  it('relationship access ranks client > sister > client-family > cold', () => {
    const val = (node, ctx) =>
      computeGravity({ ...base, ...node }, { ...noCtx, ...ctx }, NOW).factors.find(
        (f) => f.id === 'relationship_access'
      ).value;
    const client = val({ is_g7_client: true }, {});
    const sister = val({ sister_agency: true }, {});
    const family = val({}, { inClientFamily: true });
    const cold = val({}, {});
    expect(client).toBeGreaterThan(sister);
    expect(sister).toBeGreaterThan(family);
    expect(family).toBeGreaterThan(cold);
  });

  it('a fresh strong signal lifts momentum + timing and reads as rising', () => {
    const hot = computeGravity(
      { ...base, signal: { strength: 0.9, date: daysAgo(3) } },
      { ...noCtx, relevance: 0.85 },
      NOW
    );
    const cold = computeGravity(base, noCtx, NOW);
    expect(hot.score).toBeGreaterThan(cold.score);
    expect(hot.trend.dir).toBe('rising');
    expect(cold.trend.dir).toBe('stable');
    const timing = hot.factors.find((f) => f.id === 'opportunity_timing');
    expect(timing.value).toBe(1); // decay level 0
  });

  it('timing decays with the arrow level, not raw relevance', () => {
    const g = computeGravity(
      { ...base, signal: { strength: 0.9, date: daysAgo(70) } }, // level 2
      { ...noCtx, relevance: 0.4 },
      NOW
    );
    const timing = g.factors.find((f) => f.id === 'opportunity_timing');
    expect(timing.value).toBeCloseTo(1 - 2 / 6, 6);
    expect(g.trend.dir).toBe('stable'); // level 2 > 1 — not "rising"
  });

  it('COI penalty subtracts and is capped; score clamps to 0–100', () => {
    const coi = computeGravity({ ...base, coi_sensitive: true }, noCtx, NOW);
    const clean = computeGravity(base, noCtx, NOW);
    expect(coi.penaltyTotal).toBe(15);
    expect(coi.penaltyTotal).toBeLessThanOrEqual(GRAVITY_MAX_PENALTY);
    expect(clean.score - coi.score).toBe(15);
    expect(coi.score).toBeGreaterThanOrEqual(0);
    expect(clean.score).toBeLessThanOrEqual(100);
  });

  it('an unscored node still computes (placeholder capability, no crash)', () => {
    const g = computeGravity({}, noCtx, NOW);
    expect(g.score).toBeGreaterThan(0);
    expect(g.factors.find((f) => f.id === 'capability_fit').basis).toMatch(/unscored/);
  });
});
