import { describe, it, expect } from 'vitest';
import seed from '../G7_Cluster_Study_Seed_Data.json';
import { buildGraphFromSeed, buildGraphFromSheet, mergeOverlay, slugify } from '../src/graph.js';
import {
  relevance,
  computeEffectiveRelevance,
  familySteps,
  ringsFor,
  isNewAddition,
  DEFAULT_CONFIG,
} from '../public/scoring.js';

const NOW = Date.parse('2026-07-08T12:00:00Z');
// Full ISO timestamps so decay math is exact in assertions (a date-only
// string parses to UTC midnight and adds fractional-day decay).
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

describe('slugify', () => {
  it('normalizes brand names to stable ids', () => {
    expect(slugify('Olé Cocktail Co.')).toBe('ole_cocktail_co');
    expect(slugify("Jack Daniel's Fire")).toBe('jack_daniel_s_fire');
    expect(slugify('Monday.com')).toBe('monday_com');
  });
});

describe('buildGraphFromSeed', () => {
  const graph = buildGraphFromSeed(seed);

  it('creates all hub nodes as floor-state', () => {
    const hubs = graph.nodes.filter((n) => n.type === 'hub');
    expect(hubs.length).toBe(seed.hub_nodes.length);
    expect(hubs.every((h) => h.signal === null)).toBe(true);
  });

  it('dedupes adjacent brands shared across hubs (open question #1)', () => {
    const yetis = graph.nodes.filter((n) => n.id === 'yeti');
    expect(yetis.length).toBe(1);
    const yetiLinks = graph.links.filter((l) => l.target === 'yeti');
    // Yeti appears under Ram Trucks, Subaru, and Jackson Hole in the seed.
    expect(yetiLinks.length).toBe(3);
  });

  it('creates corporate parents with parent_of links and child back-references', () => {
    const mabi = graph.nodes.find((n) => n.id === 'mark_anthony_brands');
    expect(mabi.type).toBe('parent');
    const children = graph.links.filter(
      (l) => l.relationship === 'parent_of' && l.source === 'mark_anthony_brands'
    );
    expect(children.map((l) => l.target).sort()).toEqual(
      ['cayman_jack', 'mikes_hard_lemonade', 'ole', 'white_claw'].sort()
    );
    expect(graph.nodes.find((n) => n.id === 'white_claw').parent).toBe('mark_anthony_brands');
  });

  it('keeps structural analogs out of links (Section 6a.7)', () => {
    expect(graph.structural_analogs).toEqual([
      expect.objectContaining({ pair: ['mark_anthony_brands', 'swisher'] }),
    ]);
    expect(graph.links.some((l) => l.relationship === 'structurally_analogous_client')).toBe(false);
  });

  it('carries the §5a client identity marker (clients true; lapsed and non-clients false)', () => {
    const byId = (id) => graph.nodes.find((n) => n.id === id);
    expect(byId('white_claw').is_g7_client).toBe(true);
    expect(byId('turbotax_intuit').is_g7_client).toBe(false); // lapsed — stays floor-gray
    expect(byId('yeti').is_g7_client).toBe(false); // adjacent brand
    expect(byId('mark_anthony_brands').is_g7_client).toBe(false); // parent, not a direct client
    // Note: the seed marks 14 hubs true (incl. Olé); the plan §5a list has 13
    // (Olé absent) — the build trusts the JSON. Flagged for reconciliation.
    expect(graph.nodes.filter((n) => n.is_g7_client).length).toBeGreaterThanOrEqual(13);
  });

  it('carries the §5a.1 sister-agency flag (Subaru + Lagunitas only)', () => {
    expect(graph.nodes.filter((n) => n.sister_agency).map((n) => n.id).sort()).toEqual([
      'lagunitas',
      'subaru',
    ]);
  });

  it('carries COI flags onto links and nodes', () => {
    const twisted = graph.links.find((l) => l.target === 'twisted_tea');
    expect(twisted.coi_sensitive).toBe(true);
    expect(twisted.coi_note).toMatch(/MABI/);
  });
});

describe('buildGraphFromSheet', () => {
  const nodeRows = [
    { id: 'white_claw', name: 'White Claw', type: 'hub', zone: 'combo', category: 'Hard seltzer', parent: 'mabi', is_g7_client: 'TRUE', signal_strength: '0.9', signal_date: daysAgo(0), signal_type: 'signal_stacks', coi_sensitive: '', notes: 'warm relationship', date_added: '', confidence: 'verified' },
    { id: 'mabi', name: 'Mark Anthony Brands', type: 'parent', zone: '', category: '', parent: '', signal_strength: '', signal_date: '', signal_type: '', coi_sensitive: '', notes: '', date_added: '', confidence: '' },
    { id: 'truly', name: 'Truly', type: 'adjacent', zone: '', category: '', parent: '', signal_strength: '', signal_date: '', signal_type: '', coi_sensitive: 'TRUE', notes: '', date_added: '2026-07-07', confidence: '' },
    { id: '', name: '', type: '', zone: '', category: '', parent: '', signal_strength: '', signal_date: '', signal_type: '', coi_sensitive: '', notes: '', date_added: '', confidence: '' },
  ];
  const relRows = [
    { source: 'white_claw', target: 'truly', relationship: 'direct_competitor', note: 'category rival', coi_sensitive: 'true' },
    { source: 'mabi', target: 'white_claw', relationship: 'parent_of', note: '', coi_sensitive: '' },
    { source: 'white_claw', target: 'missing_node', relationship: 'direct_competitor', note: '', coi_sensitive: '' },
  ];
  const graph = buildGraphFromSheet(nodeRows, relRows);

  it('parses node rows, skipping blanks', () => {
    expect(graph.nodes.length).toBe(3);
    const wc = graph.nodes.find((n) => n.id === 'white_claw');
    expect(wc.signal).toEqual({ strength: 0.9, date: daysAgo(0), type: 'signal_stacks' });
    expect(wc.parent).toBe('mabi');
    expect(wc.is_g7_client).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'truly').is_g7_client).toBe(false);
  });

  it('drops relationships pointing at unknown nodes', () => {
    expect(graph.links.some((l) => l.target === 'missing_node')).toBe(false);
  });

  it('does not duplicate parent_of when both the tab row and parent column declare it', () => {
    const parentLinks = graph.links.filter((l) => l.relationship === 'parent_of');
    expect(parentLinks.length).toBe(1);
  });

  it('parses boolean-ish COI flags', () => {
    expect(graph.nodes.find((n) => n.id === 'truly').coi_sensitive).toBe(true);
    expect(graph.links.find((l) => l.target === 'truly').coi_sensitive).toBe(true);
  });
});

describe('relevance decay (Section 5)', () => {
  it('is strength × exponential half-life decay', () => {
    const sig = { strength: 0.8, date: daysAgo(DEFAULT_CONFIG.half_life_days), type: 'signal_stacks' };
    expect(relevance(sig, NOW)).toBeCloseTo(0.4, 5);
    expect(relevance({ ...sig, date: daysAgo(0) }, NOW)).toBeCloseTo(0.8, 5);
  });

  it('re-flagged nodes snap back immediately (open question #4)', () => {
    // A fresh signal date means full strength — no gradual ease-in.
    expect(relevance({ strength: 1, date: daysAgo(0) }, NOW)).toBe(1);
  });

  it('returns 0 for missing or malformed signals', () => {
    expect(relevance(null, NOW)).toBe(0);
    expect(relevance({ strength: 0.5, date: 'not-a-date' }, NOW)).toBe(0);
  });
});

describe('propagation (Section 6a.3)', () => {
  // Kellogg's example from the plan: signal on a child lights parent +
  // siblings at 0.5, two hops at 0.25, then stops.
  const nodes = [
    { id: 'kelloggs' },
    { id: 'pringles', signal: { strength: 1, date: daysAgo(0), type: 'signal_stacks' } },
    { id: 'cheez_it' },
    { id: 'cheez_it_snap' }, // hypothetical child of cheez_it: two hops from pringles
    { id: 'far_away' }, // three hops — must NOT light up
    { id: 'unrelated' },
  ];
  const links = [
    { source: 'kelloggs', target: 'pringles', relationship: 'parent_of' },
    { source: 'kelloggs', target: 'cheez_it', relationship: 'parent_of' },
    { source: 'cheez_it', target: 'cheez_it_snap', relationship: 'parent_of' },
    { source: 'cheez_it_snap', target: 'far_away', relationship: 'parent_of' },
    { source: 'pringles', target: 'unrelated', relationship: 'direct_competitor' },
  ];
  const eff = computeEffectiveRelevance(nodes, links, NOW);

  it('gives the signal node full strength', () => {
    expect(eff.get('pringles')).toMatchObject({ relevance: 1, hops: 0 });
  });

  it('gives parent AND sibling 0.5 (both are one step)', () => {
    expect(eff.get('kelloggs')).toMatchObject({ relevance: 0.5, hops: 1, from: 'pringles' });
    expect(eff.get('cheez_it')).toMatchObject({ relevance: 0.5, hops: 1 });
  });

  it('gives two-hops-out 0.25 and stops there (two-hop cap)', () => {
    expect(eff.get('cheez_it_snap')).toMatchObject({ relevance: 0.25, hops: 2 });
    expect(eff.has('far_away')).toBe(false);
  });

  it('never propagates through competitor/audience edges', () => {
    expect(eff.has('unrelated')).toBe(false);
  });

  it('keeps the larger value when direct signal beats propagation', () => {
    const nodes2 = [
      { id: 'p', signal: { strength: 1, date: daysAgo(0) } },
      { id: 'c', signal: { strength: 0.9, date: daysAgo(0) } },
    ];
    const links2 = [{ source: 'p', target: 'c', relationship: 'parent_of' }];
    const eff2 = computeEffectiveRelevance(nodes2, links2, NOW);
    expect(eff2.get('c')).toMatchObject({ relevance: 0.9, hops: 0 });
  });
});

describe('familySteps', () => {
  it('treats parent, child, and sibling as one step', () => {
    const steps = familySteps([
      { source: 'p', target: 'a', relationship: 'parent_of' },
      { source: 'p', target: 'b', relationship: 'parent_of' },
    ]);
    expect([...steps.get('a')].sort()).toEqual(['b', 'p']);
    expect([...steps.get('p')].sort()).toEqual(['a', 'b']);
  });
});

describe('rings (simplified two-ring model, §9 revision + §5a.1)', () => {
  it('gives ANY direct signal the unified teal Signal ring — RFP events included', () => {
    expect(ringsFor({ signal: { strength: 1, date: daysAgo(1), type: 'signal_stacks' } })).toEqual(['signal']);
    expect(ringsFor({ signal: { strength: 1, date: daysAgo(1), type: 'rfp' } })).toEqual(['signal']);
  });

  it('gives sister-agency clients the yellow ring, stacking with signal', () => {
    expect(ringsFor({ signal: null, sister_agency: true })).toEqual(['sister']);
    expect(ringsFor({ signal: { strength: 1, date: daysAgo(1), type: 'rfp' }, sister_agency: true })).toEqual([
      'signal',
      'sister',
    ]);
  });

  it('gives floor-state nodes no rings, and never a new-addition ring', () => {
    expect(ringsFor({ signal: null })).toEqual([]);
    expect(ringsFor({ signal: null, date_added: daysAgo(1) })).toEqual([]);
  });

  it('isNewAddition marks the first week only (pulsing glow, not a ring)', () => {
    expect(isNewAddition({ date_added: daysAgo(3) }, NOW)).toBe(true);
    expect(isNewAddition({ date_added: daysAgo(10) }, NOW)).toBe(false);
    expect(isNewAddition({}, NOW)).toBe(false);
  });
});

describe('mergeOverlay', () => {
  it('adds approved lookalike nodes without clobbering base nodes', () => {
    const base = buildGraphFromSeed(seed);
    const baseCount = base.nodes.length;
    const overlay = {
      nodes: [
        { id: 'white_claw', name: 'DUPLICATE — must not replace', type: 'adjacent' },
        { id: 'toyota_crown', name: 'Toyota Crown', type: 'adjacent', source: 'rfp_lookalike' },
      ],
      links: [
        { source: 'subaru', target: 'toyota_crown', relationship: 'direct_competitor', note: '' },
        { source: 'nope', target: 'toyota_crown', relationship: 'direct_competitor', note: '' },
      ],
    };
    mergeOverlay(base, overlay);
    expect(base.nodes.length).toBe(baseCount + 1);
    expect(base.nodes.find((n) => n.id === 'white_claw').name).toBe('White Claw');
    expect(base.links.some((l) => l.target === 'toyota_crown' && l.source === 'subaru')).toBe(true);
    expect(base.links.some((l) => l.source === 'nope')).toBe(false);
  });
});
