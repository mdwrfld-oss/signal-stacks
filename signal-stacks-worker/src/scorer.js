/**
 * Signal Stacks — Scoring Engine (Stage 3)
 */

const G7_CLIENT_ROSTER = [
  'white claw', 'ram trucks', 'turbotax', 'intuit', 'atlassian', 'subaru',
  'lagunitas', 'fireball', 'liquid death', 'jackson hole', 'rendezvous',
  'workday', 'cisco', 'altra running', 'years beer', 'marathon', 'honda',
  'acura', 'nissan', 'jeep', 'infiniti', 'navistar', 'mabi',
  "mike's hard lemonade", 'two chicks', 'slow & low', 'stella rosa',
  'tuaca', 'glendalough', 'cayman jack', 'sazerac', 'rey azul',
  'copper cane', 'robert hall', 'etude', 'maru-hi', 'clairol', 'clorox',
  'faire', 'gibson', 'purple mattress', 'pringles', "cap'n crunch",
  'old spice', 'pax labs', 'yeti', "kiehl's", 'smiledirectclub',
  'activia', 'danone', 'hellmanns', 'unilever', 'therabody', 'adobe',
  'genesys', 'netapp', 'reddit', 'virgin pulse', 'pwc', 'penske',
  'equity prime', 'winfield', 'kimpton', 'ihg', 'alaska airlines',
  'dicks sporting goods', 'brookfield', 'us soccer', 'bandai namco',
  'spotify', 'sony music', 'glass animals', 'ultraman', 'rodan',
  'freedom forum', 'turbo tax',
];

function buildExperientialPrompt(candidates, runDate) {
  return `
You are a business development intelligence analyst for G7 Entertainment Marketing, a full-service experiential and talent marketing agency.

Your task: evaluate the provided article candidates and identify brands that represent viable new business opportunities for G7. Return ONLY valid JSON — no commentary, no markdown code fences, no preamble.

TODAY'S DATE: ${runDate}

G7 CAPABILITIES
- Entertainment-led brand activations (festivals, tours, pop-ups, immersive events)
- Talent booking and celebrity/artist partnerships
- Product launch activations and sampling programs
- Mobile tours and experiential asset fabrication
- Sponsorship activation and cultural partnerships
- Digital amplification layered onto live experiences
- Operational execution (logistics, fabrication, staffing, mobile ops)

IDEAL BRAND PROFILE
PRIORITIZE:
- Medium to upper-mid market challenger brands scaling nationally
- PE-backed growth brands
- Brands repositioning or entering new categories
- Brands experimenting with experiential for the first time
- Brands with talent/influencer activity lacking physical activation (combo opportunity)

DEPRIORITIZE:
- Fortune 10 brands with entrenched experiential AOR relationships
- Brands publicly tied to long-term holding company experiential agencies

HIGH-FIT VERTICALS
TIER 1 (strongest fit):
- Beverage: Hard seltzer/RTD, canned cocktails, craft beer, flavored spirits
- Automotive: Trucks, SUVs, lifestyle/overland, EV
- B2B SaaS/Tech: Annual user conferences needing talent and experience design
- Outdoor/Adventure: Lifestyle brands, trail, mountain, active consumer

TIER 2 (strong fit):
- CPG: Food, personal care, household
- Spirits and premium beverages (non-alcoholic included)
- Hospitality and resort/destination
- Retail brands investing in experience
- Sports, motorsport, gaming, entertainment IP

VERTICAL DIVERSITY RULE:
No more than one-third of final output from any single vertical. Alcohol carries a conflict-of-interest flag — include but note the flag.

SIGNAL DETECTION
STRONG (+15 to +20): Confirmed RFP, major product launch within 90 days, first experiential hire
MEDIUM (+10): Celebrity/talent partnership, national retail expansion, festival sponsorship, CMO change within 6 months, multi-city activation
WEAK (+5): Cultural repositioning language

COMBO SIGNAL: Flag when brand has talent/influencer element AND that element lacks physical activation. G7's highest-value opportunity type.

CLIENT WATCH: Check every brand against this roster. If matched, set client_watch: true — these always surface regardless of score.
ROSTER: ${G7_CLIENT_ROSTER.join(', ')}

SCORING MODEL
Start at 50.
ADD: +20 confirmed RFP, +15 major product launch within 90 days, +15 first experiential hire, +10 celebrity/talent partnership, +10 national retail expansion, +10 festival sponsorship, +10 CMO/VP Marketing change within 6 months, +10 multi-city activation, +10 lookalike match to Tier 1 G7 client category, +5 cultural repositioning, +5 combo signal detected
RECENCY: +10 within 7 days, +5 within 30 days, +0 1-6 months ago
SUBTRACT: -15 documented long-term experiential AOR, -10 entrenched holding company relationship, -10 minimal marketing activity, -5 alcohol/spirits COI flag when other verticals equally strong
Cap 100. Floor 0. Threshold: 60+ only (client_watch always included).

RECENCY RULES
- Maximum signal age: 6 months from ${runDate}
- Exclude signals with no verifiable publication date
- Exclude signals older than 6 months

OUTPUT: Return STRICT JSON only. No markdown. No code fences. No commentary.
Return this exact structure:
{
  "client_watch": [],
  "combo_signals": [],
  "standard": []
}

Each signal object:
{
  "lane": "Experiential Marketing",
  "date_found": "${runDate}",
  "source_publication_date": "YYYY-MM-DD",
  "brand_name": "string",
  "brand_domain": "string (lowercase, no www)",
  "vertical": "string",
  "opportunity_type": "Product Launch | Experiential Pilot | RFP | Leadership Change | Cultural Repositioning | Talent Integration | Expansion | Client Watch",
  "summary": "2-3 sentence opportunity summary focused on why this matters for G7 right now",
  "primary_evidence_links": ["url1", "url2"],
  "opportunity_reason_rationale": ["Why aligned with G7", "Specific signal type", "Recency confirmation"],
  "combo_signal": false,
  "combo_notes": "",
  "client_watch": false,
  "lookalike_match": "",
  "alcohol_coi_flag": false,
  "score": 0
}

RULES:
- Minimum 2 evidence links per brand
- Maximum 15 brands total across all arrays
- No duplicates
- brand_domain: lowercase, no www, no trailing slash
- Only 60+ scores (client_watch always included)
- No signals older than 6 months or without verifiable dates
- No speculation — only claims supported by provided article content

CANDIDATES TO EVALUATE:
${JSON.stringify(candidates, null, 2)}
`;
}

export async function scoreCandidates(candidates, env) {
  const runDate = new Date().toISOString().split('T')[0];
  const BATCH_SIZE = 50;
  const allResults = { client_watch: [], combo_signals: [], standard: [] };

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    console.log(`[Scorer] Scoring batch ${Math.floor(i/BATCH_SIZE) + 1}: ${batch.length} candidates`);
    try {
      const batchResults = await scoreOneBatch(batch, runDate, env);
      allResults.client_watch.push(...(batchResults.client_watch || []));
      allResults.combo_signals.push(...(batchResults.combo_signals || []));
      allResults.standard.push(...(batchResults.standard || []));
    } catch (err) {
      console.error(`[Scorer] Batch ${Math.floor(i/BATCH_SIZE) + 1} failed: ${err.message}`);
    }
  }

  allResults.standard = applyDiversityRule(allResults.standard);
  allResults.client_watch.sort((a, b) => b.score - a.score);
  allResults.combo_signals.sort((a, b) => b.score - a.score);
  allResults.standard.sort((a, b) => b.score - a.score);
  allResults.standard = allResults.standard.slice(0, 10);

  console.log(`[Scorer] Final: ${allResults.client_watch.length} client watch, ${allResults.combo_signals.length} combo, ${allResults.standard.length} standard`);
  return allResults;
}

async function scoreOneBatch(candidates, runDate, env) {
  const prompt = buildExperientialPrompt(candidates, runDate);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const rawText = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error(`[Scorer] JSON parse FAILED. Raw response (first 500 chars):`);
    console.error(rawText.substring(0, 500));
    throw new Error(`JSON parse error: ${parseErr.message}`);
  }

  if (!parsed.client_watch || !parsed.combo_signals || !parsed.standard) {
    console.error(`[Scorer] Unexpected structure:`, Object.keys(parsed));
    throw new Error('Response missing expected three-tier structure');
  }

  return parsed;
}

function applyDiversityRule(signals) {
  if (signals.length === 0) return signals;
  const MAX_RATIO = 0.34;
  const verticalCounts = {};
  const result = [];
  const sorted = [...signals].sort((a, b) => b.score - a.score);
  const maxPerVertical = Math.max(1, Math.ceil(sorted.length * MAX_RATIO));

  for (const signal of sorted) {
    const vertical = (signal.vertical || 'Unknown').toLowerCase();
    verticalCounts[vertical] = (verticalCounts[vertical] || 0) + 1;
    if (verticalCounts[vertical] <= maxPerVertical) {
      result.push(signal);
    } else {
      console.log(`[Scorer] Diversity rule dropped: ${signal.brand_name} (${signal.vertical})`);
    }
  }
  return result;
}
