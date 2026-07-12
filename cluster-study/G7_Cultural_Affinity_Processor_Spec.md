# Cultural Affinity Processor — Middleware Spec

*A distinct middleware subdevelopment bridging Signal Stacks and Cluster Study. Provisional name: Cultural Affinity Processor. Companion doc to `G7_Cluster_Study_Plan.md` (see Part III for cross-references and reconciliation with earlier Part II decisions).*

---

## 1. Role of each system

**Signals** remains responsible for finding and ingesting current activity: partnerships, sponsorships, campaigns, activations, hires, product launches, RFPs, events, agency changes, talent usage, other relevant announcements.

Signals answers: *What happened, to which company, when, and how relevant might it be?*

**Cultural Affinity Processor** interprets each Signal against the Culture Space taxonomy.

It answers: *Which cultural territories does this activity relate to, how strongly, and what does it tell us about the company's established identity or current direction?*

**Clusters** visualizes the processed output.

It answers: *Where does the company sit culturally, where is it moving, and how relevant is that movement to G7?*

**Pipeline:**
```
Signal ingestion
    ↓
Entity matching and normalization
    ↓
Cultural classification
    ↓
Evidence storage and deduplication
    ↓
Momentum calculation
    ↓
Stable-affinity recalculation when warranted
    ↓
Narrative explanation
    ↓
Clusters rendering
```

## 2. Culture Space categories

Each identified signal may map to one or more of these categories (not mutually exclusive):

- Music — Performance
- Sports
- Gaming
- Comedy
- Festivals
- Talent Partnerships
- Film/TV
- Inclusion
- College Marketing
- Outdoor/Adventure
- Inter-brand Collaborations
- Influencer Partnerships
- Wellness/Fitness

**✅ Resolved (see Part III of the main plan doc):** Film/TV and Inclusion are confirmed as two separate categories. Film/TV refers to a brand's investment in TV/movie spots and screen presence; Inclusion is a distinct DEI-focused category. The FPO scoring sheet's original merged column has been split in the seed data — existing scores preserved as Film/TV, with Inclusion needing a fresh, separate scoring pass across all entities.

Example: a beverage brand sponsoring a college music festival with an artist partner could map to Music (strong), Festivals (strong), College Marketing (strong), Talent Partnerships (moderate). The processor should assign category-specific weights rather than force one primary label.

## 3. Common scoring structure

Every cultural category is evaluated through a structured rubric rather than one subjective overall rating. Common dimensions:

- **Historical Depth** — how long the company has demonstrated meaningful activity in the category, based on earliest verified evidence and continuity, not company age.
- **Recurrence or Program Maturity** — whether participation is repeated, organized, and sustained rather than a single isolated event. Category-specific variants: Inclusion (authenticity and sustained commitment), Influencer Partnerships (program maturity), Outdoor/Adventure (lifestyle integration), College Marketing (campus presence), Inter-brand Collaborations (collaboration frequency).
- **Strategic Importance** — how central the category appears to be within the company's marketing identity. A recurring activity can still be tactical rather than strategic; the processor should distinguish a supporting channel from an owned platform or defining brand pillar.
- **Recent Momentum** — whether activity is currently increasing, stable, declining, or dormant. The dimension most directly affected by newly ingested Signals.
- **Breadth of Activity** — how many materially different expressions of the category the company uses (different properties, platforms, audiences, partnership types, event types, activation formats).
- **Confidence** — how complete, recent, reliable, and internally consistent the supporting evidence is. Confidence should not be blended into affinity — a company may have low affinity with high confidence, or high estimated affinity with limited confidence.

## 4. Category-specific breadth and maturity criteria

**Music — Performance:** live performances, tour sponsorships, artist partnerships, festival programming, venue relationships, branded concerts, streaming partnerships, original music, sonic branding. Primary-expression values: `live_performance`, `artist_partnership`, `tour_sponsorship`, `festival_sponsorship`, `venue_partnership`, `original_music`, `sonic_branding`.

**Sports:** league sponsorships, team partnerships, athlete relationships, venue infrastructure, fan experiences, hospitality, youth sports, event sponsorships, sports-media relationships. A technology provider embedded in sports infrastructure scores highly for different reasons than a consumer brand built around athlete endorsements.

**Gaming:** esports, streamers, gaming creators, Twitch and Discord, publisher partnerships, branded game integrations, Roblox or Fortnite experiences, gaming hardware, tournaments, gaming-community activations.

**Comedy:** comedian partnerships, stand-up sponsorships, comedy festivals, comedic creators, comedy podcasts, sketch content, humor-led campaigns, touring comedy programs. General humorous advertising should not automatically receive the same weight as a sustained comedy-marketing platform.

**Festivals:** music festivals, food and beverage festivals, film festivals, cultural festivals, branded lounges, hospitality, sampling, sponsorship depth, recurring festival portfolios. May also generate evidence for Music, Culinary, Film/TV, or College Marketing.

**Talent Partnerships:** musicians, athletes, actors, comedians, chefs, cultural figures, celebrity ambassadors, keynote personalities, long-term spokespeople. Differentiate ongoing/exclusive partnerships from one-off bookings or appearances.

**Film/TV:** product placement, studio partnerships, streaming collaborations, entertainment-IP licensing, premieres, original branded content, series integrations, film or television sponsorships.

**Inclusion:** historical commitment, authenticity and continuity, integration into the broader brand, current activity, communities represented, accessibility, multicultural marketing, LGBTQ+ initiatives, disability inclusion, gender equity, veterans and other community programs. Distinguish sustained programs from isolated calendar-based campaigns.

**College Marketing:** campus sampling, ambassador programs, NIL, collegiate athletics, orientation activity, student organizations, campus events, spring-break or rivalry programs, college-media partnerships.

**Outdoor/Adventure:** hiking, camping, climbing, skiing, overlanding, trail running, adventure sports, conservation, outdoor events, lifestyle ambassadors. Lifestyle integration should carry more weight than isolated outdoor-event sponsorship.

**Inter-brand Collaborations:** collaboration history, frequency, partner diversity, strategic importance, cultural impact, product collaborations, limited editions, cross-category activations, entertainment- or fashion-led partnerships. Examples such as Crocs × KFC should be stored as evidence for both parties, with each company's role recorded separately.

**Influencer Partnerships:** structured creator programs, macro and micro creators, platform breadth, recurring ambassador relationships, creator-led product development, paid social partnerships, creator events, long-term versus transactional use.

**Wellness/Fitness:** gym and studio partnerships, fitness events, races, trainers, athletes used specifically in wellness contexts, nutrition, mental health, wearables, fitness creators, recovery and wellness experiences.

## 5. Signal-level output schema

Every ingested Signal should produce a normalized cultural-classification record:

```json
{
  "signal_id": "signal_123",
  "entity_id": "cisco",
  "event_date": "2026-07-11",
  "signal_type": "sports_partnership",
  "summary": "Cisco announced...",
  "source_url": "...",
  "source_title": "...",
  "source_type": "official_announcement",
  "categories": [
    {
      "category": "sports",
      "relevance": 0.92,
      "effect": "momentum",
      "expression_types": ["league_partnership", "technology_infrastructure"]
    },
    {
      "category": "talent_partnerships",
      "relevance": 0.28,
      "effect": "supporting_evidence",
      "expression_types": []
    }
  ],
  "duration_type": "multi_year",
  "recurring": true,
  "strategic_scope": "major",
  "evidence_confidence": 0.94,
  "deduplication_key": "cisco-partner-event-2026"
}
```

## 6. Processing rules between Signals and Clusters

**Entity resolution:** match the signal to an existing entity using canonical name, aliases, parent and child-brand relationships, known product names, fuzzy matching with confidence thresholds. Ambiguous matches enter review rather than silently attaching to the wrong node.

**Multi-category classification:** assign every relevant category with relevance score, expression type, confidence, effect on momentum, and possible effect on stable identity.

**Deduplication:** multiple articles about the same announcement count as one underlying event. Sources may strengthen confidence but should not multiply recurrence or momentum.

**Evidence persistence:** store normalized evidence separately from the final score, so scores can be recalculated later without repeating web research.

**Momentum update:** a new qualifying signal immediately affects recent-momentum rating, trend direction, temporary Culture Space arrow, and G7 Gravity trajectory where applicable.

**Stable-affinity review:** do not automatically change the permanent cultural-affinity position for every Signal. Reconsider a stable score when repeated signals accumulate, activity spans multiple periods, a long-term platform is announced, a major strategic shift occurs, or a category reaches a configured evidence threshold.

**Narrative regeneration:** when a score or material evidence changes, regenerate the concise explanation displayed in Clusters.

## 7. Two score layers

For every company and cultural category, retain two distinct values:

**Established Affinity** — a relatively stable rating based on the historical body of evidence (e.g., "Sports affinity: 4.4/5"). Determines the company's pull toward the Sports gravity well in Culture Space.

**Recent Momentum** — a time-sensitive measure based on current signals (e.g., "Sports momentum: 3.1/5 — Rising"). Determines temporary arrows, pulses, trajectory indicators, and changes in G7 Gravity.

A company can therefore be: high affinity/high momentum, high affinity/low momentum, low affinity/high momentum, or low affinity/low momentum. **The "low affinity, high momentum" combination is especially useful for identifying brands newly entering a G7-relevant lane.**

## 8. Clusters functionality

**Culture Space positioning:** each company's permanent Culture Space position is calculated from its established-affinity scores across all cultural wells.

**Cultural lens:** selecting a category (e.g., Sports or Music) changes node illumination according to stored affinity for that category. Intensity uses the stored score, not merely the node's physical distance from the well.

**Temporary vectors:** recent Signals create arrows toward the relevant cultural wells. Arrow treatment: direction = cultural category, length = signal importance, thickness = confidence/strategic weight, brightness = recency, duration = configured by event type.

**Entity click-through panel**, for each category:
```
Sports Affinity           4.4 / 5
Recent Momentum           3.1 / 5 — Rising
Confidence                High
Primary Expression        Platform partner / venue technology
Evidence                  14 normalized initiatives
Last reviewed             July 2026
```
Then: concise score rationale, strongest supporting evidence, why the score is not higher, why it is not lower, G7 interpretation, source links and dates.

**G7 Gravity:** processed category scores and recent momentum feed G7 Gravity, particularly capability fit, recent momentum, lookalike strength, and opportunity timing.

## 9. Summary-generation requirements

The Culture Space panel should synthesize *why* a company received its score, not merely repeat evidence. Example:

> Cisco has a sustained Sports affiliation through league relationships, venue and network infrastructure, fan-experience technology, and recurring partnerships. The score reflects long-term breadth and strategic relevance rather than broad consumer perception of Cisco as a sports brand. Recent activity is moderate, so the established affinity is higher than current momentum.
>
> **G7 interpretation:** Cisco already operates inside major sports ecosystems. Relevant outreach should build on existing platforms through hospitality, fan experiences, executive events, or talent integrations rather than presenting sports as a new territory.

## 10. Suggested data objects

`entities`, `entity_aliases`, `signals`, `cultural_evidence`, `cultural_category_scores`, `rubric_factor_scores`, `signal_vectors`, `score_history`, `classification_jobs`, `human_overrides`, `taxonomy_versions`, `model_versions`.

A category-score object:
```json
{
  "entity_id": "cisco",
  "category": "sports",
  "established_affinity": 88,
  "recent_momentum": 62,
  "trend": "rising",
  "confidence": 0.91,
  "rubric": {
    "historical_depth": 5,
    "recurrence": 5,
    "strategic_importance": 4,
    "recent_momentum": 3,
    "breadth_of_activity": 5
  },
  "primary_expressions": ["technology_infrastructure", "league_partnership", "fan_experience"],
  "summary": "...",
  "why_not_higher": "...",
  "why_not_lower": "...",
  "g7_interpretation": "...",
  "evidence_count": 14,
  "last_recalculated_at": "2026-07-11",
  "taxonomy_version": "culture_v1",
  "scoring_version": "affinity_v1"
}
```

## 11. Cost-control principles

To keep the bridge turnkey and affordable: classify evidence at ingestion rather than rerunning full research; store evidence permanently; calculate scores primarily in code; use lower-cost models for extraction and classification; use a stronger model only for narrative synthesis or disputed cases; update momentum continuously; recalculate stable affinity only after thresholds are met; run second-model review only when confidence is low or scores change materially.

## 12. Implementation boundary

**Signals owns:** discovery, source retrieval, raw event extraction, initial entity identification, source metadata.

**Cultural Affinity Processor owns:** entity resolution, cultural categorization, rubric evidence extraction, deduplication, scoring, confidence, momentum, narrative summaries, review workflow.

**Clusters owns:** map position, well illumination, signal arrows, entity detail presentation, G7 Gravity presentation, interactive filtering and exploration.

**Core function:** convert a stream of current marketing activity into persistent, explainable cultural intelligence that Clusters can position, illuminate, and act upon.
