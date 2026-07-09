/**
 * Cluster Study — Google Sheets ingestion (Section 7 update / Section 8).
 *
 * A Cron-triggered pull of the dedicated Cluster Sheet (Nodes tab +
 * Relationships tab), transformed into graph JSON and written to KV. Auth
 * reuses the Signal Stacks Service Account (SHEETS_CLIENT_EMAIL /
 * SHEETS_PRIVATE_KEY), scoped read-only; the Sheet id lives in
 * CLUSTER_SHEET_ID. The Sheet stays private — no publish-to-web.
 */

import { buildGraphFromSheet } from './graph.js';

export const GRAPH_KEY = 'graph:data';
const NODES_TAB = 'Nodes';
const RELATIONSHIPS_TAB = 'Relationships';

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const encodeSegment = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Service Account JWT → OAuth access token, via Web Crypto (RS256). */
export async function getSheetsAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: env.SHEETS_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.SHEETS_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${b64url(signature)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Google token exchange failed ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.access_token;
}

async function fetchTab(sheetId, tab, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}?majorDimension=ROWS`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    throw new Error(`Sheets read failed for tab "${tab}" ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.values || [];
}

/** First row = locked header row (by convention, not enforced in code). */
export function rowsToObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map((h) => String(h || '').trim().toLowerCase().replace(/\s+/g, '_'));
  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i] !== undefined ? String(row[i]) : '';
    });
    return obj;
  });
}

/** Pull the Sheet, transform to graph JSON, write to KV. Returns the graph. */
export async function ingestSheet(env) {
  if (!env.SHEETS_CLIENT_EMAIL || !env.SHEETS_PRIVATE_KEY || !env.CLUSTER_SHEET_ID) {
    throw new Error(
      'Missing Sheets secrets (SHEETS_CLIENT_EMAIL, SHEETS_PRIVATE_KEY, CLUSTER_SHEET_ID)'
    );
  }
  const token = await getSheetsAccessToken(env);
  const [nodeValues, relValues] = await Promise.all([
    fetchTab(env.CLUSTER_SHEET_ID, NODES_TAB, token),
    fetchTab(env.CLUSTER_SHEET_ID, RELATIONSHIPS_TAB, token),
  ]);
  const graph = buildGraphFromSheet(rowsToObjects(nodeValues), rowsToObjects(relValues));
  if (graph.nodes.length === 0) {
    // Guardrail: never clobber a good KV graph with an empty Sheet read.
    throw new Error('Sheet ingestion produced 0 nodes — refusing to overwrite KV');
  }
  await env.CLUSTER_KV.put(GRAPH_KEY, JSON.stringify(graph));
  console.log(
    `[Cluster] Sheet ingested: ${graph.nodes.length} nodes, ${graph.links.length} links`
  );
  return graph;
}
