#!/usr/bin/env node
/**
 * One-time (re-runnable) migration: pushes the hardcoded SOURCES list from
 * src/fetcher.js into the "Sources" tab of the backbone Google Sheet, so
 * the source list becomes editable there instead of requiring a redeploy.
 *
 * Creates the "Sources" tab (with a header row) if it doesn't exist yet.
 * Safe to re-run — skips any feed URL already present in the tab.
 *
 * Requires these in the environment (e.g. via `node --env-file=.env`):
 *   SHEETS_CLIENT_EMAIL
 *   SHEETS_PRIVATE_KEY
 *   SHEETS_SPREADSHEET_ID
 * These are the same Service Account credentials already set as Worker
 * secrets — pull them from wherever you originally stored them (this
 * script cannot read live Worker secrets; wrangler never exposes values).
 *
 * Usage:
 *   node --env-file=.env scripts/seed-sources-sheet.mjs
 */
import { getAccessToken } from '../src/sheets.js';
import { SOURCES } from '../src/fetcher.js';

const SOURCES_TAB = 'Sources';
const HEADER_ROW = ['name', 'feed', 'strategy', 'lane', 'active'];

async function main() {
  const env = {
    SHEETS_CLIENT_EMAIL: requireEnv('SHEETS_CLIENT_EMAIL'),
    SHEETS_PRIVATE_KEY: requireEnv('SHEETS_PRIVATE_KEY'),
    SHEETS_SPREADSHEET_ID: requireEnv('SHEETS_SPREADSHEET_ID'),
  };

  const accessToken = await getAccessToken(env);

  const exists = await tabExists(env, accessToken);
  if (!exists) {
    console.log(`Creating "${SOURCES_TAB}" tab...`);
    await createTab(env, accessToken);
    await writeHeaderRow(env, accessToken);
  } else {
    console.log(`"${SOURCES_TAB}" tab already exists.`);
  }

  const existingFeeds = await readExistingFeeds(env, accessToken);
  const toAdd = SOURCES.filter(s => !existingFeeds.has(s.feed));

  if (toAdd.length === 0) {
    console.log('Nothing to add — all hardcoded sources are already in the sheet.');
    return;
  }

  const rows = toAdd.map(s => [s.name, s.feed, s.strategy, s.lane, 'TRUE']);
  await appendRows(env, accessToken, rows);
  console.log(`Added ${toAdd.length} source(s): ${toAdd.map(s => s.name).join(', ')}`);
  console.log(`Skipped ${SOURCES.length - toAdd.length} already-present source(s).`);
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
  return (data.sheets || []).some(s => s.properties.title === SOURCES_TAB);
}

async function createTab(env, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}:batchUpdate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SOURCES_TAB } } }] }),
  });
  if (!response.ok) throw new Error(`Failed to create tab: ${response.status} ${await response.text()}`);
}

async function writeHeaderRow(env, accessToken) {
  const range = `${encodeURIComponent(SOURCES_TAB)}!A1:E1`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}?valueInputOption=RAW`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ values: [HEADER_ROW] }),
  });
  if (!response.ok) throw new Error(`Failed to write header row: ${response.status} ${await response.text()}`);
}

async function readExistingFeeds(env, accessToken) {
  const range = `${encodeURIComponent(SOURCES_TAB)}!B2:B`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Failed to read existing rows: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return new Set((data.values || []).map(row => row[0]).filter(Boolean));
}

async function appendRows(env, accessToken, rows) {
  const range = `${encodeURIComponent(SOURCES_TAB)}!A:E`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ values: rows }),
  });
  if (!response.ok) throw new Error(`Failed to append rows: ${response.status} ${await response.text()}`);
}

main().catch(err => {
  console.error('Seed script failed:', err.message);
  process.exit(1);
});
