/**
 * Standalone export: bundles the Cluster Study frontend into ONE
 * self-contained HTML file that opens directly from disk (file://) — no dev
 * server, no Worker, no CDN, no network at all.
 *
 *   node scripts/export-standalone.mjs [--out export/index.html]
 *
 * What gets inlined and why:
 * - d3.min.js (vendored)            — no CDN dependency
 * - style.css                       — no stylesheet request
 * - scoring.js + layout.js + app.js — Chrome refuses ES-module imports over
 *   file://, so the modules are concatenated into one inline script with
 *   import/export statements stripped
 * - the graph JSON                  — fetch() of local files is also blocked
 *   over file://, so the data is embedded (pulled from the live /data
 *   endpoint when reachable, falling back to the bundled seed)
 *
 * The export is view-only: the RFP pipeline endpoints and Sheet ingestion
 * live in the Worker and aren't part of this file. Drag/snap layout
 * persistence still works (localStorage is available on file://).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import seed from '../G7_Cluster_Study_Seed_Data.json' with { type: 'json' };
import { buildGraphFromSeed } from '../src/graph.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const outFlag = process.argv.indexOf('--out');
const outPath = resolve(root, outFlag !== -1 ? process.argv[outFlag + 1] : 'export/index.html');

/* ---------------------------------------------------------------- graph */

const DATA_URL = 'https://cluster-study-worker.matt-weiner-5c1.workers.dev/data';
let graph;
try {
  const resp = await fetch(DATA_URL, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  graph = await resp.json();
  console.log(`Graph: live /data (${graph.source}, ${graph.nodes.length} nodes)`);
} catch (err) {
  graph = buildGraphFromSeed(seed);
  console.log(`Graph: live /data unreachable (${err.message}) — bundled seed fallback (${graph.nodes.length} nodes)`);
}

/* ------------------------------------------------------------------- js */

const stripModules = (src) =>
  src
    // strip multi-line and single-line imports of our local modules
    .replace(/^import[\s\S]*?from\s+['"]\/(?:scoring|layout)\.js['"];\s*$/gm, '')
    .replace(/^export\s+/gm, '');

let appJs = stripModules(read('public/app.js'));

// Swap the /data fetch for the embedded graph. Exact-match so a future
// app.js refactor breaks the export loudly instead of silently.
const FETCH_BLOCK = `  const resp = await fetch('/data');
  if (!resp.ok) throw new Error(\`/data returned \${resp.status}\`);
  const graph = await resp.json();`;
if (!appJs.includes(FETCH_BLOCK)) {
  console.error('ERROR: could not find the /data fetch block in app.js — update export-standalone.mjs');
  process.exit(1);
}
// The await is load-bearing: init() is kicked off at module top level, and
// without an await it would run synchronously before later const declarations
// (linkId, drag helpers) initialize — a TDZ crash the original fetch avoided.
appJs = appJs.replace(
  FETCH_BLOCK,
  () => '  const graph = await Promise.resolve(window.__CLUSTER_GRAPH__);'
);

const bundleJs = [
  '/* ---- scoring.js ---- */',
  stripModules(read('public/scoring.js')),
  '/* ---- layout.js ---- */',
  stripModules(read('public/layout.js')),
  '/* ---- app.js ---- */',
  appJs,
].join('\n');

if (/^\s*import\s/m.test(bundleJs) || bundleJs.includes("fetch('/data')")) {
  console.error('ERROR: bundle still contains an import or /data fetch');
  process.exit(1);
}

/* ----------------------------------------------------------------- html */

// </script> inside inlined JS/JSON would terminate the tag early.
const scriptSafe = (s) => s.replace(/<\/script/gi, '<\\/script');

let html = read('public/index.html');

const replaceOnce = (source, from, to, what) => {
  if (!source.includes(from)) {
    console.error(`ERROR: could not find ${what} in index.html — update export-standalone.mjs`);
    process.exit(1);
  }
  // Function form: replacement text is taken literally. d3.min.js (and any
  // JS/JSON payload) can contain `$&`-style patterns that String.replace
  // would otherwise expand — that bug re-injects the matched tag.
  return source.replace(from, () => to);
};

html = replaceOnce(
  html,
  '<link rel="stylesheet" href="/style.css" />',
  `<style>\n${read('public/style.css')}\n</style>`,
  'the stylesheet link'
);
html = replaceOnce(
  html,
  '<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>',
  `<script>${scriptSafe(read('scripts/vendor/d3.min.js'))}</script>`,
  'the d3 CDN script tag'
);
html = replaceOnce(
  html,
  '<script type="module" src="/app.js"></script>',
  `<script>window.__CLUSTER_GRAPH__ = ${scriptSafe(JSON.stringify(graph))};</script>\n` +
    `<script type="module">\n${scriptSafe(bundleJs)}\n</script>`,
  'the app module script tag'
);
html = html.replace(
  '<title>G7 Cluster Study</title>',
  `<title>G7 Cluster Study — standalone export (${graph.generated?.split('T')[0] || 'unknown date'})</title>`
);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${Math.round(html.length / 1024)} KB) — open it directly in a browser.`);
