/**
 * Signal Stacks — Google Sheets backbone (Stage 5)
 * Service Account auth via Web Crypto JWT signing (no SDK).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Combo Signals retired as a separate tier (2026-07-17) — everything files
// under Standard now. Client Watch stays mapped (writeSignalsToSheets simply
// never writes there while scored.client_watch is structurally empty,
// pending a refreshed client roster), so historical rows in those tabs stay
// intact and the tab starts populating again automatically once re-enabled.
const TABS_BY_LANE = {
  experiential: {
    client_watch: 'Client Watch',
    standard:     'Standard',
  },
  talent: {
    client_watch: 'Client Watch (T)',
    standard:     'Standard (T)',
  },
};

const SOURCES_TAB = 'Sources';

// Reads the "Sources" tab (name | feed | strategy | lane | active) so the
// source list is editable without a redeploy. Returns [] on any failure —
// the caller falls back to the hardcoded SOURCES list in that case.
export async function readSourcesFromSheet(env) {
  try {
    const accessToken = await getAccessToken(env);
    const range = `${encodeURIComponent(SOURCES_TAB)}!A2:E`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Sheets API error ${response.status} reading '${SOURCES_TAB}': ${err}`);
    }
    const data = await response.json();
    return parseSourceRows(data.values || []);
  } catch (err) {
    console.error(`[Sheets] Sources read failed: ${err.message}`);
    return [];
  }
}

export function parseSourceRows(rows) {
  return rows
    .map(([name, feed, strategy, lane, active]) => ({ name, feed, strategy, lane, active }))
    .filter(row => row.name && row.feed && isActiveFlag(row.active))
    .map(({ name, feed, strategy, lane }) => ({
      name,
      feed,
      strategy: strategy || 'RSS_FEED',
      lane: lane || 'experiential',
    }));
}

// Blank/missing active column defaults to active (opt-out, not opt-in) so a
// freshly seeded or forgotten cell doesn't silently disable a source.
function isActiveFlag(value) {
  if (value === undefined || value === null || value === '') return true;
  const normalized = String(value).trim().toLowerCase();
  return !['false', 'no', '0', 'inactive'].includes(normalized);
}

export async function appendSourceToSheet(source, env) {
  const accessToken = await getAccessToken(env);
  const range = `${encodeURIComponent(SOURCES_TAB)}!A:E`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ values: [[source.name, source.feed, source.strategy, source.lane, 'TRUE']] }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Sheets API error ${response.status} appending to '${SOURCES_TAB}': ${err}`);
  }
}

export async function writeSignalsToSheets(scored, env, lane = 'experiential') {
  const accessToken = await getAccessToken(env);
  const tabByTier = TABS_BY_LANE[lane] || TABS_BY_LANE.experiential;

  for (const [tier, tab] of Object.entries(tabByTier)) {
    const signals = scored[tier] || [];
    if (signals.length === 0) continue;
    const rows = signals.map((signal, index) => signalToRow(signal, buildSignalId(signal, lane, tier, index)));
    await appendRows(tab, rows, accessToken, env);
    console.log(`[Sheets] Appended ${rows.length} rows to '${tab}'`);
  }
}

// Composite key (date:lane:tier:index) rather than a random or sequential
// ID — derivable purely from data already in hand when the row is written,
// so there's no counter to coordinate and no race condition across
// concurrent lane/tier writes. Stable as long as signals are append-only
// (a re-run never rewrites an existing row in place).
export function buildSignalId(signal, lane, tier, index) {
  const date = signal.date_found || new Date().toISOString().split('T')[0];
  return `${date}:${lane}:${tier}:${index}`;
}

function signalToRow(signal, signalId) {
  const links = signal.primary_evidence_links || [];
  const rationale = signal.opportunity_reason_rationale || [];
  return [
    signal.date_found || '',
    signal.source_publication_date || '',
    signal.brand_name || '',
    signal.brand_domain || '',
    signal.vertical || '',
    signal.opportunity_type || '',
    signal.summary || '',
    links[0] || '',
    links[1] || '',
    rationale[0] || '',
    rationale[1] || '',
    rationale[2] || '',
    signal.combo_notes || '',
    signal.lookalike_match || '',
    !!signal.alcohol_coi_flag,
    signal.score || 0,
    signal.lane || '',
    signal.source || '',
    (signal.score_breakdown || []).join('; '),
    signalId,
    signal.client_watch_roster_match || '',
  ];
}

async function appendRows(tab, rows, accessToken, env) {
  const range = `${encodeURIComponent(tab)}!A:U`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_SPREADSHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ values: rows }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Sheets API error ${response.status} on '${tab}': ${err}`);
  }
}

export async function getAccessToken(env) {
  const jwt = await buildSignedJwt(env);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google OAuth token error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.access_token;
}

async function buildSignedJwt(env) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: env.SHEETS_CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = await importPrivateKey(env.SHEETS_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64urlFromBuffer(signature)}`;
}

async function importPrivateKey(pem) {
  const contents = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(contents);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function base64url(str) {
  return base64urlFromBuffer(new TextEncoder().encode(str));
}

function base64urlFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
