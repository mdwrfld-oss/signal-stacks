/**
 * Build a static GitHub Pages bundle from public/.
 *
 *   node scripts/build-pages.mjs
 *
 * The live app is a Cloudflare Worker (dynamic /data from KV). GitHub Pages is
 * static-only and served from a PROJECT SUBPATH (…/signal-stacks/), so this
 * emits a self-contained mirror at the repo-root docs/ folder:
 *   - absolute module imports + the /data fetch are rewritten to RELATIVE
 *     paths (an absolute /app.js would resolve to the domain root, not the
 *     project subpath, and 404);
 *   - the graph is baked into data.json via the same seed+CSV ingest pipeline
 *     the Worker's KV holds, so the static mirror matches production.
 *
 * Server-backed features (Generate Competitors, RFP review) are inert on the
 * static mirror by design — it's a read-only view of the map.
 *
 * Re-run after any change to public/ or the seed. GitHub Pages source =
 * this branch + /docs.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..'); // cluster-study/
const pub = path.join(projectRoot, 'public');
const repoRoot = path.resolve(projectRoot, '..'); // signal-stacks/
const docs = path.join(repoRoot, 'docs'); // GitHub Pages /docs source

mkdirSync(docs, { recursive: true });

// 1. data.json — same seed + Signals1.csv graph the Worker's KV serves.
execSync(`node scripts/ingest-csv.mjs Signals1.csv --out ${JSON.stringify(path.join(docs, 'data.json'))}`, {
  cwd: projectRoot,
  stdio: 'inherit',
});

// 2. Dependency-free assets copy verbatim.
for (const f of ['style.css', 'scoring.js', 'verticals.js']) {
  copyFileSync(path.join(pub, f), path.join(docs, f));
}

// 3. index.html — absolute asset refs → relative.
const html = readFileSync(path.join(pub, 'index.html'), 'utf8')
  .replaceAll('href="/style.css"', 'href="./style.css"')
  .replaceAll('src="/app.js"', 'src="./app.js"');
writeFileSync(path.join(docs, 'index.html'), html);

// 4. app.js — absolute imports + the /data fetch → relative (data.json).
const app = readFileSync(path.join(pub, 'app.js'), 'utf8')
  .replaceAll("from '/scoring.js'", "from './scoring.js'")
  .replaceAll("from '/verticals.js'", "from './verticals.js'")
  .replaceAll("fetch('/data')", "fetch('./data.json')");
writeFileSync(path.join(docs, 'app.js'), app);

// 5. Disable Jekyll so files are served as-is.
writeFileSync(path.join(docs, '.nojekyll'), '');

console.log(`\nBuilt static GitHub Pages bundle → ${path.relative(repoRoot, docs)}/`);
console.log('GitHub Pages source: this branch, /docs folder.');
