/**
 * Cluster Study — RFP-triggered lookalike pipeline (Section 6 / Gate 2).
 *
 * Input: an RFP brief (pasted text) for a client G7 pitched (won or lost).
 * Steps 2–5 of the Section 6.1 pipeline run in one agentic Claude request:
 * extraction → web-search lookalike hunt → licensor/agency resolution →
 * strict-JSON ranked candidate list. Step 6 (human review) is the /review
 * page: candidates land in KV as pending and only become live Cluster nodes
 * on approval.
 *
 * The competitor-vs-analogous call is a judgment call, not a lookup
 * (Section 6.2) — the prompt carries worked examples as few-shot anchors.
 */

import { slugify } from './graph.js';

export const PENDING_PREFIX = 'rfp:pending:';
export const OVERLAY_KEY = 'graph:overlay';

const MODEL = 'claude-opus-4-8';
const MAX_CONTINUATIONS = 5;

function buildPrompt({ rfpText, clientName, lane, outcome }) {
  const today = new Date().toISOString().split('T')[0];
  return `You are a business development intelligence analyst for G7 Entertainment Marketing, a full-service experiential and talent marketing agency.

G7 ${outcome === 'won' ? 'won' : 'pitched and did not win'} an RFP for ${clientName || 'the client described below'}${lane ? ` (${lane} lane)` : ''}. The deep research already done for this pitch is valuable: your job is to surface PARALLEL BRANDS worth talking to next — not to re-analyze the pitch itself.

TODAY'S DATE: ${today}

STEP 1 — EXTRACT a structured profile from the RFP material:
- target_audience: demographic/psychographic description
- ip_category: the product/IP category and vertical
- licensor: who holds the brand/licensing relationship, if applicable
- notes: anything else that shapes who counts as a lookalike

STEP 2 — SEARCH the web for adjacent brands. Find both:
- direct_competitor: same category, same medium, competing for the same buyers
- analogous_audience: different category or medium, but the same audience profile and the same reason G7's pitch concepts would land

CALIBRATION EXAMPLES (competitor vs analogous is a judgment call — anchor on these):
- If the RFP client were Ultraman (tokusatsu IP): Power Rangers = direct_competitor (tokusatsu, same medium and category). Pokémon = analogous_audience (overlapping fan demo, different medium).
- If the RFP client were a hard-seltzer brand: another hard seltzer = direct_competitor; a non-carbonated spiked drink pulling the same Gen Z drinkers = analogous_audience.

STEP 3 — for each candidate, identify who holds the licensing/marketing relationship (licensor or agency). Treat this as "best guess, verify before outreach" — these relationships change hands and go stale. Include when you last saw it confirmed.

OUTPUT: Return STRICT JSON only. No markdown fences, no commentary. Exactly this structure:
{
  "profile": {
    "target_audience": "string",
    "ip_category": "string",
    "licensor": "string or null",
    "notes": "string"
  },
  "candidates": [
    {
      "brand": "string",
      "relationship": "direct_competitor" | "analogous_audience",
      "licensor_or_agency": "string or null",
      "licensor_last_verified": "YYYY-MM-DD or null",
      "confidence": "high" | "medium" | "low",
      "rationale": "one line on why this brand is worth a conversation"
    }
  ]
}

RULES:
- 6-12 candidates, ranked most promising first
- No duplicates, and do not include ${clientName || 'the RFP client'} itself
- rationale must be specific to what the RFP taught us, not generic
- Only claims supported by search results or the RFP text below

RFP MATERIAL:
${rfpText}`;
}

function extractJson(content) {
  const rawText = (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  // Defensive: grab the outermost JSON object if there's stray prose.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Steps 2–5: one agentic request with server-side web search. */
export async function runLookalikeSearch(input, env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
  const prompt = buildPrompt(input);
  let messages = [{ role: 'user', content: prompt }];
  let response;

  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }],
        messages,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
    }
    response = await resp.json();
    if (response.stop_reason !== 'pause_turn') break;
    // Server-side tool loop paused — resume where it left off.
    messages = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: response.content },
    ];
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('Model declined the request (refusal stop reason)');
  }

  const parsed = extractJson(response.content);
  if (!parsed.profile || !Array.isArray(parsed.candidates)) {
    throw new Error('Response missing expected profile/candidates structure');
  }
  parsed.candidates = parsed.candidates.filter(
    (c) =>
      c &&
      c.brand &&
      ['direct_competitor', 'analogous_audience'].includes(c.relationship)
  );
  return parsed;
}

/** Run the pipeline and store the result as a pending review batch in KV. */
export async function createPendingBatch(input, env) {
  const result = await runLookalikeSearch(input, env);
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const batch = {
    id,
    created: new Date().toISOString(),
    client_name: input.clientName || null,
    client_hub_id: input.clientHubId || null,
    lane: input.lane || null,
    outcome: input.outcome || 'lost',
    rfp_excerpt: String(input.rfpText).slice(0, 500),
    profile: result.profile,
    candidates: result.candidates.map((c) => ({ ...c, status: 'pending' })),
  };
  await env.CLUSTER_KV.put(PENDING_PREFIX + id, JSON.stringify(batch));
  return batch;
}

export async function listPendingBatches(env) {
  const list = await env.CLUSTER_KV.list({ prefix: PENDING_PREFIX });
  const batches = await Promise.all(
    list.keys.map(async (k) => JSON.parse(await env.CLUSTER_KV.get(k.name)))
  );
  return batches.filter(Boolean).sort((a, b) => (a.created < b.created ? 1 : -1));
}

/**
 * Step 6 — human review. decisions: [{ brand, approve: bool }].
 * Approved candidates become floor-state overlay nodes linked to the RFP
 * client's hub node (no ring, no invented signal — they earn relevance when
 * Signal Stacks lights them up).
 */
export async function reviewBatch({ id, decisions }, env) {
  const key = PENDING_PREFIX + id;
  const batch = JSON.parse((await env.CLUSTER_KV.get(key)) || 'null');
  if (!batch) throw new Error(`No pending batch ${id}`);

  const byBrand = new Map((decisions || []).map((d) => [d.brand, !!d.approve]));
  const overlay = JSON.parse((await env.CLUSTER_KV.get(OVERLAY_KEY)) || '{"nodes":[],"links":[]}');
  const overlayIds = new Set(overlay.nodes.map((n) => n.id));
  const today = new Date().toISOString().split('T')[0];

  let approved = 0;
  for (const candidate of batch.candidates) {
    if (!byBrand.has(candidate.brand)) continue;
    candidate.status = byBrand.get(candidate.brand) ? 'approved' : 'rejected';
    if (candidate.status !== 'approved') continue;
    approved++;
    const nodeId = slugify(candidate.brand);
    if (!overlayIds.has(nodeId)) {
      overlayIds.add(nodeId);
      overlay.nodes.push({
        id: nodeId,
        name: candidate.brand,
        type: 'adjacent',
        category: batch.profile?.ip_category || null,
        zone: null,
        parent: null,
        confidence: candidate.confidence || null,
        g7_notes: {
          relationship_notes: `RFP lookalike (${batch.client_name || 'unknown client'}, ${batch.outcome}). ${candidate.rationale || ''}`,
          licensor_or_agency: candidate.licensor_or_agency || null,
          licensor_last_verified: candidate.licensor_last_verified || null,
        },
        coi_sensitive: false,
        signal: null,
        date_added: today,
        source: 'rfp_lookalike',
      });
    }
    if (batch.client_hub_id) {
      overlay.links.push({
        source: batch.client_hub_id,
        target: nodeId,
        relationship: candidate.relationship,
        note: candidate.rationale || '',
        coi_sensitive: false,
      });
    }
  }

  await env.CLUSTER_KV.put(OVERLAY_KEY, JSON.stringify(overlay));
  const allDecided = batch.candidates.every((c) => c.status !== 'pending');
  if (allDecided) {
    await env.CLUSTER_KV.delete(key);
  } else {
    await env.CLUSTER_KV.put(key, JSON.stringify(batch));
  }
  return { id, approved, remaining_pending: allDecided ? 0 : undefined, batch };
}
