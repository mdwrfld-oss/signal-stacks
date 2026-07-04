export const SOURCES = [
  { name: 'Event Marketer',       feed: 'https://www.eventmarketer.com/feed/',         strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'BizBash',              feed: 'https://www.bizbash.com/rss.xml',             strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'Skift Meetings',       feed: 'https://meetings.skift.com/feed',             strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'Adweek Experiential',  feed: 'https://www.adweek.com/feed/',                strategy: 'RSS_FEED', lane: 'both'          },
  { name: 'Marketing Dive',       feed: 'https://www.marketingdive.com/feeds/news/',   strategy: 'RSS_FEED', lane: 'both'          },
  { name: 'PRNEWS',               feed: 'https://www.prnewsonline.com/feed/',          strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'Chief Marketer',       feed: 'https://www.chiefmarketer.com/feed',          strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'IEG/Sponsorship.com',  feed: 'https://sponsorship.com/feed',               strategy: 'RSS_FEED', lane: 'both'          },
  { name: 'Front Office Sports',  feed: 'https://frontofficesports.com/feed',          strategy: 'RSS_FEED', lane: 'both'          },
  { name: 'Jack Morton Blog',     feed: 'https://jackmorton.com/feed/',                strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'GPJ News & Insights',  feed: 'https://www.gpj.com/feed',                   strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'Freeman Trends',       feed: 'https://freeman.com/feed',                   strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'IAEE',                 feed: 'https://www.iaee.com/feed/',                  strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'PCMA',                 feed: 'https://www.pcma.org/feed/',                  strategy: 'RSS_FEED', lane: 'experiential' },
  { name: 'Patch',                feed: 'https://patch.com/feeds/all.atom.xml',        strategy: 'RSS_FEED', lane: 'experiential' },
];

const FETCH_TIMEOUT_MS  = 10000;
const MAX_ITEMS_PER_FEED = 20;
const DEDUP_TTL_SECONDS  = 60 * 60 * 24 * 90;

export async function fetchAllSources(env) {
  const candidates = [];
  const errors = [];

  for (const source of SOURCES) {
    try {
      console.log(`[Fetcher] Fetching: ${source.name}`);
      let items = [];
      if (source.strategy === 'RSS_FEED') {
        items = await fetchRssFeed(source.feed);
      } else if (source.strategy === 'SITEMAP') {
        items = await fetchSitemap(source.feed);
      } else {
        items = await fetchBoundedCrawl(source.feed);
      }
      console.log(`[Fetcher] ${source.name}: ${items.length} items found`);

      for (const item of items) {
        // TEMP: dedup disabled for scoring test — re-enable before launch
        const seen = false;
        if (!seen) {
          candidates.push({ ...item, sourceName: source.name, lane: source.lane });
        }
      }
    } catch (err) {
      const msg = `[Fetcher] ERROR on ${source.name}: ${err.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  if (errors.length > 0) {
    console.error(`[Fetcher] ${errors.length} source(s) failed:\n${errors.join('\n')}`);
  }

  console.log(`[Fetcher] Total new candidates: ${candidates.length}`);
  return candidates;
}

export async function markAsSeen(url, env) {
  const key = dedupKey(url);
  await env.SIGNAL_KV.put(key, '1', { expirationTtl: DEDUP_TTL_SECONDS });
}

async function fetchRssFeed(feedUrl) {
  const xml = await fetchText(feedUrl);
  return parseRss(xml);
}

function parseRss(xml) {
  const items = [];
  const isAtom = xml.includes('<entry');
  const itemTag = isAtom ? 'entry' : 'item';
  const itemPattern = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, 'gi');

  let match;
  while ((match = itemPattern.exec(xml)) !== null && items.length < MAX_ITEMS_PER_FEED) {
    const block = match[1];
    const url         = extractTag(block, isAtom ? 'link' : 'link', isAtom) ||
                        extractAttr(block, 'link', 'href');
    const title       = cleanText(extractTag(block, 'title'));
    const summary     = cleanText(extractTag(block, isAtom ? 'summary' : 'description'));
    const publishedAt = extractTag(block, isAtom ? 'published' : 'pubDate') ||
                        extractTag(block, 'updated');

    if (url && url.startsWith('http')) {
      items.push({ url: url.trim(), title, summary, publishedAt });
    }
  }
  return items;
}

async function fetchSitemap(sitemapUrl) {
  const xml = await fetchText(sitemapUrl);
  if (xml.includes('<sitemapindex')) {
    const subUrls = extractAllTags(xml, 'loc').slice(0, 3);
    const allItems = [];
    for (const subUrl of subUrls) {
      try {
        const subXml = await fetchText(subUrl);
        allItems.push(...parseSitemapUrls(subXml));
      } catch {}
    }
    return allItems;
  }
  return parseSitemapUrls(xml);
}

function parseSitemapUrls(xml) {
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
  return urlBlocks
    .map(block => ({
      url: extractTag(block, 'loc'),
      publishedAt: extractTag(block, 'lastmod'),
      title: '',
      summary: '',
    }))
    .filter(item => item.url && item.url.startsWith('http') && looksLikeArticle(item.url))
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, MAX_ITEMS_PER_FEED);
}

async function fetchBoundedCrawl(pageUrl) {
  const html = await fetchText(pageUrl);
  const origin = new URL(pageUrl).origin;
  const hrefPattern = /href=["']([^"']+)["']/gi;
  const links = [];
  let match;
  while ((match = hrefPattern.exec(html)) !== null) {
    let href = match[1];
    if (href.startsWith('/')) href = origin + href;
    if (href.startsWith(origin) && looksLikeArticle(href)) {
      links.push({ url: href, title: '', summary: '', publishedAt: '' });
    }
  }
  const seen = new Set();
  return links
    .filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, MAX_ITEMS_PER_FEED);
}

function dedupKey(url) {
  const normalized = url.trim().replace(/\/$/, '').replace(/^http:/, 'https:');
  return `seen:${normalized}`;
}

async function isAlreadySeen(url, env) {
  try {
    const val = await env.SIGNAL_KV.get(dedupKey(url));
    return val !== null;
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SignalStacksBot/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function extractTag(xml, tag, isAtom = false) {
  if (isAtom && tag === 'link') return null;
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(pattern);
  if (!match) return '';
  return cleanText(match[1]);
}

function extractAttr(xml, tag, attr) {
  const pattern = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["'][^>]*>`, 'i');
  const match = xml.match(pattern);
  return match ? match[1] : '';
}

function extractAllTags(xml, tag) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results = [];
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    results.push(cleanText(match[1]));
  }
  return results;
}

function cleanText(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

function looksLikeArticle(url) {
  const articlePatterns = [
    /\/20\d{2}\//,
    /\/blog\//i,
    /\/news\//i,
    /\/article\//i,
    /\/post\//i,
    /\/story\//i,
    /\/insights?\//i,
    /\/resources?\//i,
    /\/press\//i,
    /\/updates?\//i,
  ];
  const excludePatterns = [
    /\?page=/i,
    /\/category\//i,
    /\/tag\//i,
    /\/author\//i,
    /\/page\/\d/i,
  ];
  return articlePatterns.some(p => p.test(url)) && !excludePatterns.some(p => p.test(url));
}
