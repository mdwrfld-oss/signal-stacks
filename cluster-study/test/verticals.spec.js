import { describe, it, expect } from 'vitest';
import seed from '../G7_Cluster_Study_Seed_Data.json';
import { buildGraphFromSeed } from '../src/graph.js';
import {
  BUSINESS_VERTICALS,
  CULTURAL_VERTICALS,
  normalizeScores,
  weightedPosition,
  centroid,
} from '../public/verticals.js';

describe('taxonomies (final scored-data schema)', () => {
  it('has 9 business wells and 13 cultural wells matching the seed keys exactly', () => {
    expect(BUSINESS_VERTICALS.length).toBe(9);
    expect(CULTURAL_VERTICALS.length).toBe(13);
    const bizIds = BUSINESS_VERTICALS.map((v) => v.id);
    for (const id of ['beauty_retail', 'media_social_platforms', 'entertainment']) {
      expect(bizIds).toContain(id);
    }
    const cultIds = CULTURAL_VERTICALS.map((v) => v.id);
    expect(cultIds).toContain('film_tv');
    expect(cultIds).toContain('inclusion'); // film_tv_inclusion split in two
    expect(cultIds).not.toContain('film_tv_inclusion');
  });

  it('taxonomy keys cover every key the seed actually uses (and vice versa)', () => {
    const bizIds = new Set(BUSINESS_VERTICALS.map((v) => v.id));
    const cultIds = new Set(CULTURAL_VERTICALS.map((v) => v.id));
    for (const hub of seed.hub_nodes) {
      expect(Object.keys(hub.business_verticals).sort()).toEqual([...bizIds].sort());
      expect(Object.keys(hub.cultural_verticals).sort()).toEqual([...cultIds].sort());
    }
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

describe('graph integration (final scored data)', () => {
  const graph = buildGraphFromSeed(seed);

  it('all 19 hubs carry both complete scored objects; the legacy vertical field is gone', () => {
    const hubs = graph.nodes.filter((n) => n.type === 'hub');
    expect(hubs.length).toBe(19);
    for (const h of hubs) {
      expect(Object.keys(h.business_verticals).length).toBe(9);
      expect(Object.keys(h.cultural_verticals).length).toBe(13);
      expect(h.vertical).toBeUndefined();
    }
  });

  it('carries the real scoring (Ulta inclusion 5; Rendezvous now fully scored)', () => {
    const ulta = graph.nodes.find((n) => n.id === 'ulta_beauty');
    expect(ulta.cultural_verticals.inclusion).toBe(5);
    const rmf = graph.nodes.find((n) => n.id === 'rendezvous_music_festival');
    expect(rmf.cultural_verticals.music_performance).toBeGreaterThan(0);
    expect(rmf.parent).toBe('jackson_hole_mountain_resort');
  });

  it('non-hub nodes carry no scored objects (positioned relationally)', () => {
    const yeti = graph.nodes.find((n) => n.id === 'yeti');
    expect(yeti.business_verticals).toBeUndefined();
  });
});
