/**
 * ⚠ ARTIFICIAL DEMO HACK — presentation only, NOT real data.
 *
 * The 48 CAP Phase 2c backfill entities were ingested without signal dates, so
 * they render floor-dim. This assigns each a randomized signal (deterministic
 * seed → reproducible) purely so their recency-decay glows vary on screen for
 * the demo. KV-only: the seed JSON is never touched.
 *
 *   node scripts/demo-signals-48.mjs            # writes /tmp demo graph
 *   node scripts/demo-signals-48.mjs --out x.json
 *
 * Publish:  wrangler kv key put graph:data --path <out> --namespace-id d9279c728d564684b782d8e45827a94a --remote
 * REVERT:   re-run scripts/ingest-csv.mjs and publish that (clean, no fake dates).
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const outFlag = process.argv.indexOf('--out');
const outPath = outFlag !== -1 ? process.argv[outFlag + 1] : '/tmp/cluster-demo-graph.json';
const basePath = '/tmp/cluster-demo-base.json';

// 1. Rebuild the real graph (67 hubs + the 4 genuine CSV signals) via the
//    normal ingest — so those real signals/wells are preserved untouched.
execSync(`node scripts/ingest-csv.mjs Signals1.csv --out ${JSON.stringify(basePath)}`, {
  cwd: projectRoot,
  stdio: 'inherit',
});
const graph = JSON.parse(readFileSync(basePath, 'utf8'));

// 2. Deterministic PRNG so the spread is reproducible run-to-run.
let s = 0x2f6e2b1 >>> 0;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().split('T')[0];

// 3. Give each backfill entity (provisional_bootstrap, no real signal yet) a
//    fake signal. Dates span ~2–130 days so relevance decay (42-day half-life)
//    produces a full range of glow intensities. No cultural_wells → no arrows,
//    just the variable glow (+ the unified signal ring).
let count = 0;
for (const n of graph.nodes) {
  if (n.confidence !== 'provisional_bootstrap' || n.signal) continue;
  n.signal = {
    strength: +(0.55 + rand() * 0.4).toFixed(2), // 0.55–0.95
    date: daysAgo(2 + Math.floor(rand() * 128)), // ~2–130 days ago
    type: 'signal_stacks',
    demo: true, // marks this as artificial (easy to grep/strip later)
  };
  count++;
}

graph.source = 'seed+csv+demo48';
graph.generated = new Date().toISOString();
writeFileSync(outPath, JSON.stringify(graph));
console.log(`\n⚠ DEMO: assigned artificial randomized signals to ${count} backfill entities.`);
console.log(`Wrote ${outPath}`);
console.log(
  `Publish: npx wrangler kv key put graph:data --path ${outPath} --namespace-id d9279c728d564684b782d8e45827a94a --remote`
);
