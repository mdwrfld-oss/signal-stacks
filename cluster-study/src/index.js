/**
 * Cluster Study Worker — serving + ingestion (Section 8 revised architecture).
 *
 * - scheduled(): Cron pulls the Cluster Sheet → graph JSON → KV
 * - fetch(): /data (KV graph, seed fallback, + approved RFP overlay),
 *   /health, /run (manual ingest), /api/rfp/* (lookalike pipeline + review)
 * - Static assets (D3 frontend) served from ./public via the ASSETS binding.
 */

import seedData from '../G7_Cluster_Study_Seed_Data.json';
import { buildGraphFromSeed, mergeOverlay } from './graph.js';
import { ingestSheet, GRAPH_KEY } from './sheets.js';
import {
  createPendingBatch,
  listPendingBatches,
  reviewBatch,
  OVERLAY_KEY,
} from './lookalike.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const authorized = (request, env) => {
  const auth = request.headers.get('Authorization') || '';
  return !!env.TRIGGER_SECRET && auth === `Bearer ${env.TRIGGER_SECRET}`;
};

export default {
  async scheduled(event, env, ctx) {
    console.log(`[Cluster] Cron fired at ${new Date().toISOString()}`);
    ctx.waitUntil(
      ingestSheet(env).catch((err) => {
        // Sheet not configured yet is expected while the seed bootstrap is
        // the data source — /data falls back to the bundled seed JSON.
        console.error(`[Cluster] Sheet ingestion failed: ${err.message}`);
      })
    );
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        secrets: {
          ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY,
          SHEETS_CLIENT_EMAIL: !!env.SHEETS_CLIENT_EMAIL,
          SHEETS_PRIVATE_KEY: !!env.SHEETS_PRIVATE_KEY,
          CLUSTER_SHEET_ID: !!env.CLUSTER_SHEET_ID,
          TRIGGER_SECRET: !!env.TRIGGER_SECRET,
          CLUSTER_KV: !!env.CLUSTER_KV,
        },
      });
    }

    if (url.pathname === '/data' && request.method === 'GET') {
      let graph = JSON.parse((await env.CLUSTER_KV.get(GRAPH_KEY)) || 'null');
      if (!graph) graph = buildGraphFromSeed(seedData);
      const overlay = JSON.parse((await env.CLUSTER_KV.get(OVERLAY_KEY)) || 'null');
      mergeOverlay(graph, overlay);
      return json(graph);
    }

    if (url.pathname === '/run' && request.method === 'POST') {
      if (!authorized(request, env)) return new Response('Unauthorized', { status: 401 });
      try {
        const graph = await ingestSheet(env);
        return json({ status: 'ingested', nodes: graph.nodes.length, links: graph.links.length });
      } catch (err) {
        return json({ status: 'error', message: err.message }, 500);
      }
    }

    if (url.pathname === '/api/rfp/run' && request.method === 'POST') {
      if (!authorized(request, env)) return new Response('Unauthorized', { status: 401 });
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }
      if (!body.rfp_text || String(body.rfp_text).trim().length < 40) {
        return json({ error: 'rfp_text is required (paste the RFP brief / response summary)' }, 400);
      }
      try {
        const batch = await createPendingBatch(
          {
            rfpText: body.rfp_text,
            clientName: body.client_name,
            clientHubId: body.client_hub_id,
            lane: body.lane,
            outcome: body.outcome,
          },
          env
        );
        return json({ status: 'pending_review', batch });
      } catch (err) {
        console.error(`[Cluster] Lookalike pipeline failed: ${err.message}`);
        return json({ status: 'error', message: err.message }, 500);
      }
    }

    if (url.pathname === '/api/rfp/pending' && request.method === 'GET') {
      if (!authorized(request, env)) return new Response('Unauthorized', { status: 401 });
      return json({ batches: await listPendingBatches(env) });
    }

    if (url.pathname === '/api/rfp/review' && request.method === 'POST') {
      if (!authorized(request, env)) return new Response('Unauthorized', { status: 401 });
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }
      if (!body.id || !Array.isArray(body.decisions)) {
        return json({ error: 'id and decisions[] are required' }, 400);
      }
      try {
        const result = await reviewBatch(body, env);
        return json({ status: 'reviewed', ...result });
      } catch (err) {
        return json({ status: 'error', message: err.message }, 500);
      }
    }

    // Everything else falls through to static assets (index.html, app.js, ...).
    return env.ASSETS.fetch(request);
  },
};
