import { describe, it, expect } from 'vitest';
import seed from '../G7_Cluster_Study_Seed_Data.json';
import { buildGraphFromSeed } from '../src/graph.js';
import {
  BUSINESS_VERTICALS,
  CULTURAL_VERTICALS,
  normalizeScores,
  weightedPosition,
  centroid,
  stubVerticalScores,
} from '../public/verticals.js';

describe('taxonomies (II.10 — provisional)', () => {
  it('has 6 business verticals and the 12 enumerated cultural verticals', () => {
    expect(BUSINESS_VERTICALS.length).toBe(6);
    // Plan says "11" but enumerates 12 — implementing the enumeration (flagged).
    expect(CULTURAL_VERTICALS.length).toBe(12);
    expect(CULTURAL_VERTICALS.map((v) => v.id)).toContain('inter_brand_collaborations');
  });
});

describe('normalizeScores (II.1: 0–5 display → normalized weights)', () => {
  it('normalizes to weights summing to 1', () => {
    const w = normalizeScores({ food_beverage: 5, sports: 5 }, BUSINESS_VERTICALS);
    expect(w.food_beverage).toBeCloseTo(0.5);
    expect(w.sports).toBeCloseTo(0.5);
  });

  it('clamps out-of-range scores and drops unknown verticals', () => {
    const w = normalizeScores(
      { food_beverage: 99, made_up_vertical: 5, sports: -3 },
      BUSINESS_VERTICALS
    );
    expect(w).toEqual({ food_beverage: 1 });
  });

  it('returns null when nothing scores (no position on that map)', () => {
    expect(normalizeScores({}, BUSINESS_VERTICALS)).toBeNull();
    expect(normalizeScores(null, BUSINESS_VERTICALS)).toBeNull();
  });
});

describe('weightedPosition (II.2)', () => {
  const anchors = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 100, y: 0 }],
  ]);

  it('is the anchor itself for a single-vertical entity', () => {
    expect(weightedPosition({ a: 1 }, anchors)).toEqual({ x: 0, y: 0 });
  });

  it('sits between wells proportional to weights (the hybrid-brand mechanism)', () => {
    // 5 vs 3-ish split: Liquid Death-style hybrid lands between, nearer the 5.
    const w = normalizeScores({ a: 5, b: 3 }, [{ id: 'a' }, { id: 'b' }]);
    const pos = weightedPosition(w, anchors);
    expect(pos.x).toBeCloseTo(37.5);
  });

  it('returns null when no weights resolve to anchors', () => {
    expect(weightedPosition(null, anchors)).toBeNull();
    expect(weightedPosition({ zzz: 1 }, anchors)).toBeNull();
  });
});

describe('centroid (II.4 parent position rule)', () => {
  it('averages child positions, ignoring nulls', () => {
    expect(centroid([{ x: 0, y: 0 }, { x: 100, y: 50 }, null])).toEqual({ x: 50, y: 25 });
    expect(centroid([])).toBeNull();
  });
});

describe('stub scoring + graph integration (phase-1 placeholder)', () => {
  const graph = buildGraphFromSeed(seed);

  it('every hub gets both scored objects, dominant business vertical at 5', () => {
    const hubs = graph.nodes.filter((n) => n.type === 'hub');
    expect(hubs.length).toBe(15);
    for (const h of hubs) {
      expect(h.business_verticals[h.vertical]).toBe(5);
      expect(typeof h.cultural_verticals).toBe('object');
    }
  });

  it('derived secondaries spread hubs off the pure single-anchor stub', () => {
    const jh = graph.nodes.find((n) => n.id === 'jackson_hole');
    expect(jh.cultural_verticals.festival).toBe(5);
    expect(jh.business_verticals.sports).toBe(2); // secondary alongside dominant 5
  });

  it('seed-supplied scored fields would take precedence over the stub', () => {
    const scored = stubVerticalScores({
      id: 'white_claw',
      vertical: 'food_beverage',
    });
    expect(scored.business_verticals.food_beverage).toBe(5);
    // graph.js only calls the stub when the seed lacks the field:
    const fake = {
      hub_nodes: [
        {
          id: 'x',
          name: 'X',
          vertical: 'sports',
          business_verticals: { cpgs: 4 },
          cultural_verticals: { gaming: 2 },
        },
      ],
    };
    const g = buildGraphFromSeed(fake);
    expect(g.nodes[0].business_verticals).toEqual({ cpgs: 4 });
    expect(g.nodes[0].cultural_verticals).toEqual({ gaming: 2 });
  });

  it('non-hub nodes carry no scored objects (positioned relationally)', () => {
    const yeti = graph.nodes.find((n) => n.id === 'yeti');
    expect(yeti.business_verticals).toBeUndefined();
  });
});
