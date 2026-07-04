import { fetchAllSources, markAsSeen } from './fetcher.js';
import { scoreCandidates } from './scorer.js';

export default {

  async scheduled(event, env, ctx) {
    console.log(`[Signal Stacks] Cron fired at ${new Date().toISOString()}`);
    ctx.waitUntil(enqueueBatches(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        secrets: {
          ANTHROPIC_API_KEY:     !!env.ANTHROPIC_API_KEY,
          SLACK_EXPERIENTIAL:    !!env.SLACK_EXPERIENTIAL,
          SLACK_TALENT:          !!env.SLACK_TALENT,
          SHEETS_CLIENT_EMAIL:   !!env.SHEETS_CLIENT_EMAIL,
          SHEETS_PRIVATE_KEY:    !!env.SHEETS_PRIVATE_KEY,
          SHEETS_SPREADSHEET_ID: !!env.SHEETS_SPREADSHEET_ID,
          TRIGGER_SECRET:        !!env.TRIGGER_SECRET,
          SIGNAL_KV:             !!env.SIGNAL_KV,
          SIGNAL_QUEUE:          !!env.SIGNAL_QUEUE,
        }
      });
    }

    if (url.pathname === '/run' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      if (auth !== `Bearer ${env.TRIGGER_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }
      ctx.waitUntil(enqueueBatches(env));
      return Response.json({ status: 'triggered', timestamp: new Date().toISOString() });
    }

    return new Response('Signal Stacks Worker', { status: 200 });
  },

  // Queue consumer — each message is one batch of candidates to score
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const { candidates, runDate } = message.body;
        console.log(`[Queue] Processing batch of ${candidates.length} candidates`);

        const scored = await scoreCandidates(candidates, env);

        const total = scored.client_watch.length + scored.combo_signals.length + scored.standard.length;
        console.log(`[Queue] Batch complete — ${total} signals surfaced`);
        console.log(`[Queue] Client Watch: ${scored.client_watch.length}`);
        console.log(`[Queue] Combo: ${scored.combo_signals.length}`);
        console.log(`[Queue] Standard: ${scored.standard.length}`);

        // Mark candidates as seen
        for (const candidate of candidates) {
          await markAsSeen(candidate.url, env);
        }

        // Log sample outputs
        if (scored.client_watch[0]) console.log(`[Queue] Sample client_watch:`, JSON.stringify(scored.client_watch[0]));
        if (scored.combo_signals[0]) console.log(`[Queue] Sample combo:`, JSON.stringify(scored.combo_signals[0]));
        if (scored.standard[0]) console.log(`[Queue] Sample standard:`, JSON.stringify(scored.standard[0]));

        message.ack();
      } catch (err) {
        console.error(`[Queue] Batch failed: ${err.message}`);
        message.retry();
      }
    }
  },
};

// Fetch all candidates and split into Queue messages of 50 each
async function enqueueBatches(env) {
  console.log(`[Pipeline] Starting fetch at ${new Date().toISOString()}`);

  const candidates = await fetchAllSources(env);
  console.log(`[Pipeline] ${candidates.length} new candidates — splitting into batches`);

  if (candidates.length === 0) {
    console.log(`[Pipeline] No new candidates this run`);
    return;
  }

  const BATCH_SIZE = 50;
  let batchCount = 0;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    await env.SIGNAL_QUEUE.send({
      candidates: batch,
      runDate: new Date().toISOString().split('T')[0],
    });
    batchCount++;
    console.log(`[Pipeline] Queued batch ${batchCount}: ${batch.length} candidates`);
  }

  console.log(`[Pipeline] All ${batchCount} batches queued`);
}
