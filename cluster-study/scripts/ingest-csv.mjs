/**
 * One-time Backbone Sheet CSV ingestion (demo bootstrap — not the live
 * pipeline). Usage:
 *
 *   node scripts/ingest-csv.mjs <signals.csv> [--out graph.json]
 *
 * Matches each row's Brand Name against the Cluster node set (hubs AND
 * adjacent/competitor nodes from the seed JSON). Exact-after-normalization
 * matches activate the node's signal (strength = Score/100, date = Source
 * Publication Date, decay handled by the existing relevance formula at view
 * time). Near-misses are FLAGGED for human review, never applied — a wrong
 * match silently applied is worse than a short review list.
 *
 * With --create-unmatched, brands with NO node in the set become new
 * adjacent nodes with their signal active and a §4f sector inferred from the
 * CSV's Vertical column (they arrive unconnected — Signal Stacks found them,
 * research hasn't linked them yet).
 *
 * With --out, writes the seed graph + activated signals as graph JSON ready
 * for `wrangler kv key put graph:data --path <file> --remote`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import seed from '../G7_Cluster_Study_Seed_Data.json' with { type: 'json' };
import { buildGraphFromSeed, slugify } from '../src/graph.js';

/* CSV Vertical → §4f sector (keyword heuristics; unknown → null). */
const SECTOR_RULES = [
  [/beverage|beer|seltzer|spirits|wine|whiskey|food|snack/i, 'food_beverage'],
  [/auto|transport|truck|vehicle|ev\b/i, 'automotive'],
  [/saas|software|tech|b2b/i, 'tech_b2b'],
  [/sport|league|entertainment/i, 'sports'],
  [/cpg|retail|beauty|household|toy|skincare|personal care/i, 'cpg'],
  [/hospitality|travel|tourism|resort|hotel/i, 'hospitality'],
];
const sectorFor = (vertical) => {
  for (const [re, sector] of SECTOR_RULES) if (re.test(vertical || '')) return sector;
  return null;
};

/* ------------------------------------------------------------- CSV parse */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
  }
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

/* ---------------------------------------------------------- name matching */

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

/**
 * Exact (normalized) → confident match. Anything merely CLOSE — small edit
 * distance, token containment either way — is ambiguous: flagged, not applied.
 */
function matchBrand(brandName, nodes) {
  const norm = normalize(brandName);
  const exact = nodes.filter((n) => normalize(n.name) === norm);
  if (exact.length === 1) return { match: exact[0], ambiguous: [] };
  if (exact.length > 1) return { match: null, ambiguous: exact.map((n) => near(n, 'duplicate normalized name')) };

  const ambiguous = [];
  for (const n of nodes) {
    const nodeNorm = normalize(n.name);
    const dist = editDistance(norm, nodeNorm);
    const threshold = Math.max(1, Math.floor(Math.min(norm.length, nodeNorm.length) * 0.25));
    if (dist <= threshold) {
      ambiguous.push(near(n, `edit distance ${dist}`));
      continue;
    }
    if (norm.length >= 4 && nodeNorm.length >= 4 && (norm.includes(nodeNorm) || nodeNorm.includes(norm))) {
      ambiguous.push(near(n, 'name containment'));
    }
  }
  return { match: null, ambiguous };

  function near(n, reason) {
    return { id: n.id, name: n.name, type: n.type, reason };
  }
}

/* ------------------------------------------------------------------- main */

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/ingest-csv.mjs <signals.csv> [--out graph.json]');
  process.exit(1);
}
const outFlag = process.argv.indexOf('--out');
const outPath = outFlag !== -1 ? process.argv[outFlag + 1] : null;
const createUnmatched = process.argv.includes('--create-unmatched');

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const graph = buildGraphFromSeed(seed);

const matched = [];
const ambiguous = [];
const unmatched = [];

for (const row of rows) {
  const brand = (row.brand_name || '').trim();
  if (!brand) continue;
  const { match, ambiguous: near } = matchBrand(brand, graph.nodes);
  const signal = {
    strength: Math.min(1, (parseFloat(row.score) || 50) / 100),
    date: (row.source_publication_date || row.date_found || '').trim(),
    type: 'signal_stacks',
  };
  if (match) {
    matched.push({ brand, nodeId: match.id, nodeName: match.name, signal, summary: row.summary });
  } else if (near.length) {
    ambiguous.push({ brand, candidates: near, row: { score: row.score, date: row.source_publication_date, lane: row.lane } });
  } else {
    unmatched.push({ brand, vertical: row.vertical, score: row.score });
  }
}

// Apply confident matches only; multiple rows for one node keep the signal
// whose (undecayed) strength+recency wins at view time — i.e. latest date,
// tie-broken by strength.
const byNode = new Map();
for (const m of matched) {
  const prev = byNode.get(m.nodeId);
  if (!prev || m.signal.date > prev.signal.date || (m.signal.date === prev.signal.date && m.signal.strength > prev.signal.strength)) {
    byNode.set(m.nodeId, m);
  }
}
for (const [nodeId, m] of byNode) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  node.signal = m.signal;
}

// --create-unmatched: new-opportunity brands become new adjacent nodes with
// live signals (best row per brand), sector-placed, unlinked until researched.
const created = [];
if (createUnmatched) {
  const byBrand = new Map();
  for (const row of rows) {
    const brand = (row.brand_name || '').trim();
    if (!unmatched.some((u) => u.brand === brand)) continue;
    const prev = byBrand.get(brand);
    const date = (row.source_publication_date || row.date_found || '').trim();
    if (!prev || date > prev.date) byBrand.set(brand, { row, date });
  }
  for (const [brand, { row, date }] of byBrand) {
    const node = {
      id: slugify(brand),
      name: brand,
      type: 'adjacent',
      category: (row.vertical || '').trim() || null,
      zone: null,
      parent: null,
      sector: sectorFor(row.vertical),
      is_g7_client: false,
      confidence: null,
      g7_notes: row.summary ? { relationship_notes: row.summary } : null,
      coi_sensitive: String(row.alcohol_coi_flag).toUpperCase() === 'TRUE',
      signal: {
        strength: Math.min(1, (parseFloat(row.score) || 50) / 100),
        date,
        type: 'signal_stacks',
      },
      date_added: (row.date_found || date || '').trim() || null,
      source: 'csv',
    };
    graph.nodes.push(node);
    created.push(node);
  }
}

graph.source = 'seed+csv';
graph.generated = new Date().toISOString();

console.log('=== One-time CSV ingestion report ===\n');
console.log(`CSV rows:            ${rows.length}`);
console.log(`Confident matches:   ${matched.length} (${byNode.size} unique nodes activated)`);
for (const m of byNode.values()) {
  console.log(`  ✓ ${m.brand} → ${m.nodeName} (${m.nodeId}) strength ${m.signal.strength}, ${m.signal.date}`);
}
console.log(`\nAmbiguous (FLAGGED for review, NOT applied): ${ambiguous.length}`);
for (const a of ambiguous) {
  console.log(`  ? "${a.brand}" ~ ${a.candidates.map((c) => `${c.name} [${c.type}, ${c.reason}]`).join('; ')}`);
}
console.log(`\nNo match in node set: ${unmatched.length}`);
for (const u of unmatched) {
  console.log(`  - ${u.brand} (${u.vertical}, score ${u.score})`);
}
if (created.length) {
  console.log(`\nCreated as NEW signal nodes (--create-unmatched): ${created.length}`);
  for (const c of created) {
    console.log(`  + ${c.name} → sector ${c.sector || '(none)'}, strength ${c.signal.strength}, ${c.signal.date}`);
  }
}

const activated = byNode.size + created.length;
if (outPath && activated > 0) {
  writeFileSync(outPath, JSON.stringify(graph));
  console.log(`\nGraph with ${activated} activated signals written to ${outPath}`);
  console.log('Publish with: npx wrangler kv key put graph:data --path ' + outPath + ' --namespace-id 366abe6c402243878e7b1d3b03d4a446 --remote');
} else if (outPath) {
  console.log('\nNo confident matches — nothing written (KV left untouched).');
}
