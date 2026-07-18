#!/usr/bin/env node
/**
 * One-time migration: moves the 5 sites whose sitemaps were detected but
 * whose content is mostly non-news (artist rosters, login pages, undated
 * case-study portfolios) into a "Poor Quality Sources" reference tab —
 * NOT read by the weekly pipeline (only the "Sources" tab is), just kept
 * for later reference in case any of these turns out to be worth revisiting.
 *
 * Creates the "Poor Quality Sources" tab (with a header row) if it doesn't
 * exist yet. Safe to re-run — skips any feed URL already present in the tab.
 *
 * Requires these in the environment (e.g. via `node --env-file=.env`):
 *   SHEETS_CLIENT_EMAIL
 *   SHEETS_PRIVATE_KEY
 *   SHEETS_SPREADSHEET_ID
 *
 * Usage:
 *   node --env-file=.env scripts/archive-poor-quality-sources.mjs
 */
import { getAccessToken } from '../src/sheets.js';

const TAB = 'Poor Quality Sources';
const HEADER_ROW = ['name', 'feed', 'strategy', 'lane', 'reason'];

// Pulled from the live dynamic_sources KV entry these were added to during
// Browser Run testing on 2026-07-17 — sitemap detection succeeded for all
// 5, but the sitemap content is mostly non-news (see reason column).
const SOURCES = [
  { name: 'SME Live Nation', feed: 'https://www.smelivenation.com/sitemap.xml', strategy: 'SITEMAP', lane: 'experiential', reason: 'Sitemap is artist roster/booking pages, not dated news' },
  { name: 'Empire Entertainment', feed: 'https://www.empireentertainment.com/sitemap.xml', strategy: 'SITEMAP', lane: 'experiential', reason: 'Sitemap is mostly login/account/portal pages' },
  { name: 'Drury Design', feed: 'https://www.drurydesign.com/sitemap.xml', strategy: 'SITEMAP', lane: 'experiential', reason: 'Sitemap is undated case-study portfolio pages' },
  { name: 'DEGY', feed: 'https://www.degy.com/sitemap.xml', strategy: 'SITEMAP', lane: 'experiential', reason: 'Sitemap is static nav pages (markets/process/about), no news section' },
  { name: 'Booking Entertainment', feed: 'https://www.bookingentertainment.com/sitemap.xml', strategy: 'SITEMAP', lane: 'experiential', reason: 'Sitemap exists and is reachable from the Worker (403s a plain curl), but same non-news content pattern as the others' },
];

async function main() {
  const env = {
    SHEETS_CLIENT_EMAIL: requireEnv('SHEETS_CLIENT_EMAIL'),
    SHEETS_PRIVATE_KEY: requireEnv('SHEETS_PRIVATE_KEY'),
    SHEETS_SPREADSHEET_ID: requireEnv('SHEETS_SPREADSHEET_ID'),
  };

  const accessToken = await getAccessToken(env);

  const exists = await tabExists(env, accessToken);
  if (!exists) {
    console.log(`Creating "${TAB}" tab...`);
    await createTab(env, accessToken);
    await writeHeaderRow(env, accessToken);
  } else {
    console.log(`"${TAB}" tab already exists.`);
  }

  const existingFeeds = await readExistingFeeds(env, accessToken);
  const toAdd = SOURCES.filter(s => !existingFeeds.has(s.feed));

  if (toAdd.length === 0) {
    console.log('Nothing to add — all 5 are already in the tab.');
    return;
  }

  const rows = toAdd.map(s => [s.name, s.feed, s.strategy, s.lane, s.reason]);
  await appendRows(env, accessToken, rows);
  console.log(`Added ${toAdd.length} source(s): ${toAdd.map(s => s.name).join(', ')}`);
  console.log('\nNext step: once confirmed in the sheet, clear these out of the live');
  console.log('dynamic_sources KV entry so they stop being fetched every run, e.g.:');
  console.log('  npx wrangler kv key put dynamic_sources \'[]\' --namespace-id 1ac1fc603c7e47319cd6fed6c814c1c7 --remote');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function tabExists(env, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}?fields=sheets.properties.title`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Failed to read spreadsheet metadata: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return (data.sheets || []).some(s => s.properties.title === TAB);
}

async function createTab(env, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}:batchUpdate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }),
  });
  if (!response.ok) throw new Error(`Failed to create tab: ${response.status} ${await response.text()}`);
}

async function writeHeaderRow(env, accessToken) {
  const range = `${encodeURIComponent(TAB)}!A1:E1`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}?valueInputOption=RAW`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ values: [HEADER_ROW] }),
  });
  if (!response.ok) throw new Error(`Failed to write header row: ${response.status} ${await response.text()}`);
}

async function readExistingFeeds(env, accessToken) {
  const range = `${encodeURIComponent(TAB)}!B2:B`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Failed to read existing rows: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return new Set((data.values || []).map(row => row[0]).filter(Boolean));
}

async function appendRows(env, accessToken, rows) {
  const range = `${encodeURIComponent(TAB)}!A:E`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ values: rows }),
  });
  if (!response.ok) throw new Error(`Failed to append rows: ${response.status} ${await response.text()}`);
}

main().catch(err => {
  console.error('Archive script failed:', err.message);
  process.exit(1);
});
