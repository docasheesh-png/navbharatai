// Live web-search grounding for the chat surfaces (admin 2026-07-12: "hamesha latest response de").
//
// The recencyDirective() already stops the AI from stating stale data as current. THIS goes one step
// further: for a message that clearly needs up-to-the-minute facts (sports squads/scores, news, prices,
// "who currently is…", latest versions, "aaj/abhi/latest"), it runs a REAL web search and hands the
// fresh results to the model so the answer is grounded in today's data — not the training cutoff.
//
// Design:
//  • GATED — only runs when the message shows a recency/fresh-fact signal (needsLiveSearch). Everyday
//    chat, greetings, coding help, personal talk never pay the search latency.
//  • BOUNDED — the whole search is capped (default 6s); a slow/flaky SERP never hangs the reply. On
//    timeout or zero results it returns '' and the caller proceeds (recencyDirective keeps it honest).
//  • KEY-FREE — uses the existing WebSearch (Brave when BRAVE_API_KEY is set, else DuckDuckGo), so it
//    works out of the box and improves automatically when a key is added.

import { WebSearch, formatSearchResults } from '../AgentV3/WebSearch';
import { webFetchUrl, capText } from '../AgentV3/webFetch';
import { liveTransitContext } from './transitLive';

/** Fresh-fact signals in English + Hindi/Hinglish. Kept deliberately specific to avoid over-searching. */
const FRESH_SIGNAL =
  /\b(latest|newest|new(?:est)?\s+version|current(?:ly)?|today'?s?|tonight|right now|recent(?:ly)?|this\s+(?:year|month|week)|these days|breaking|news|headline|update[ds]?|released?|launch(?:ed|ing)?|score|scores|result|results|won|winner|winning|champion|final|tournament|series|match|squad|line-?up|captain|standings?|ranking|price|prices|rate|rates|cost|stock|shares?|market|who\s+(?:is|won|are|holds|leads)|weather|temperature|forecast|20(?:2[4-9]|3\d))\b/i;

/** Hindi / Devanagari fresh-fact signals. */
const FRESH_SIGNAL_HI =
  /(आज|अभी|ताज़ा|ताजा|इस\s*साल|आजकल|अभी\s*का|नया|नई|नये|खबर|समाचार|स्कोर|कीमत|रेट|भाव|कौन\s*(?:है|जीता|जीती|हैं)|किसने|कितना|कितने|वर्तमान|हाल\s*(?:ही|का))/;

/**
 * DAILY-LIFE signals (admin 2026-08-25: "train kab hai, bus kaha milegi, flight kitna late hai …
 * isme aap bachi sari daily use ki cheeze add karo"). Each pattern is an INTENT, not a bare noun —
 * "train" alone would fire on "train a model" in the builder chat, so transit words are anchored to a
 * question word (kab/kaha/status/late/…) or an unambiguous token (PNR, IRCTC, running status).
 */
const DAILY_LIFE_SIGNAL: RegExp[] = [
  // Transit: trains, buses, metro, flights, cabs — schedule, delay, platform, live position.
  /\b(?:train|rail(?:way)?|metro|bus|flight|udaan|cab|auto)\w*\b.{0,20}\b(?:kab|kaha+n?|kitn[ai]|kitne|status|late|delay|time|timing|schedule|number|no\.?|live|chal(?:egi|ega)?|aa(?:egi|yegi|ega|yega)|pahu?nch\w*|milegi|milega)/i,
  /\b(?:kab|kaha+n?|kitn[ai]|kitne|kaun\s*si|which|next|last|pehli|aakhri)\s+(?:\w+\s+){0,2}?(?:train|bus|metro|flight|udaan|local)\b/i,
  /\b(?:pnr|irctc|running\s+status|live\s+(?:location|status|position)|platform\s+(?:no|number|kaun)|waiting\s*list|seat\s+availab|train\s+\d{5}|rajdhani|shatabdi|vande\s*bharat)/i,
  /\b(?:flight|udaan)\s+(?:kitn[ai]|kitna\s+late|status|delay|cancel|on\s*time)|airport\s+(?:kab|kitni\s+door|status)/i,
  // Local daily needs: fuel, gas, gold/silver, mandi, weather, AQI, traffic, power cuts, holidays.
  /\b(?:petrol|diesel|cng|lpg|cylinder|gas)\b.{0,24}\b(?:rate|price|bhav|daam|kitn)/i,
  /\b(?:sona|sone|gold|chandi|silver)\b.{0,24}\b(?:rate|price|bhav|daam|kitn)/i,
  /\b(?:mandi|sabzi|vegetable)\s+(?:bhav|rate|price|ka\s+bhav)/i,
  /\b(?:mausam|barish|baarish|garmi|sardi|aqi|air\s+quality|pollution|traffic|jam)\b/i,
  /\b(?:bijli|power|light)\s+(?:cut|kab\s+aayegi|gayi)/i,
  /\b(?:bank|school|market|mandi|office)\s+(?:khul|band|open|closed|holiday|chutti|chhutti)/i,
  /\b(?:holiday|chutti|chhutti)\b.{0,20}\b(?:kab|hai|list|aaj|kal)/i,
  /\b(?:movie|film|show)\s*(?:time|timing|kab|ticket|kaun\s*si\s+lagi)/i,
  /\b(?:board|exam|result|admit\s*card|merit)\b.{0,24}\b(?:kab|date|aa\s*gaya|declared|niklega|nikla)/i,
  // "Near me": the answer depends on WHERE the user is — search still helps once a place is named,
  // and the recency directive tells the model to ask for the city when none is given.
  /\b(?:near\s*me|nearest|near\s*by|nearby|aas\s*[- ]?paas|mere\s+paas|sabse\s+(?:nazdeek|najdeek|paas|kareeb|karib))\b/i,
  /\b(?:kaha+n?\s+(?:milegi|milega|hai|par\s+hai))\b.{0,30}\b(?:atm|hospital|medical|pharmacy|dava|dawai|petrol\s*pump|police|clinic|doctor)\b/i,
  /\b(?:atm|hospital|medical\s+store|pharmacy|petrol\s*pump|police\s+station|clinic)\b.{0,24}\b(?:kaha+n?|milegi|milega|near|paas|nazdeek|najdeek)/i,
];

/**
 * Romanized-Hindi recency words ("aaj", "abhi", "taaza", …). These are NOT self-sufficient on
 * purpose: "abhi ye error fix karo" is builder chat, not a fresh-facts question, and every false
 * trigger costs the user seconds of search latency. They count only next to a fact-question word.
 */
const ROMAN_RECENCY = /\b(?:aaj|abhi|taa?za|is\s+saal|aajkal|ajkal|filhaal|halfilhaal)\b/i;
const ROMAN_FACT = /\b(?:kya|kitn[ai]|kitne|kaun|kis(?:ne|ka|ki)|kab|kaha+n?|rate|price|bhav|news|khabar|score|match|weather|mausam|jeet|haar|result)\b/i;

/**
 * Should this message be grounded with a live web search? PURE + exported for testing. True when a
 * clear recency/fresh-fact signal is present and the message isn't a trivial greeting/thanks.
 */
export function needsLiveSearch(message: string): boolean {
  const m = (message || '').trim();
  if (m.length < 3) return false;
  // Skip pure greetings / thanks (no real question).
  if (/^(hi|hello|hey|namaste|namaskar|ram[- ]?ram|thanks|thank you|shukriya|dhanyavaad|ok|okay|hmm)\b[.!\s]*$/i.test(m)) {
    return false;
  }
  if (FRESH_SIGNAL.test(m) || FRESH_SIGNAL_HI.test(m)) return true;
  if (DAILY_LIFE_SIGNAL.some((re) => re.test(m))) return true;
  return ROMAN_RECENCY.test(m) && ROMAN_FACT.test(m);
}

/**
 * The query actually sent to the search engine. PURE + exported for testing.
 *
 * A Hinglish sentence is a poor SERP query ("train 12301 kaha pahunchi" finds forums, not status), so
 * the unambiguous shapes are rewritten into the query that search engines answer well. Everything else
 * goes through verbatim — rewriting a query we don't understand can only lose information.
 */
export function shapeSearchQuery(message: string, now: Date = new Date()): string {
  const m = String(message ?? '').trim();
  const today = now.toISOString().slice(0, 10);
  const train = /\b(?:train|rail|gadi|gaadi|ट्रेन|रेल)\b/i.test(m) && m.match(/\b(\d{5})\b/);
  if (train) return `train ${train[1]} live running status today`;
  const pnr = m.match(/\bpnr\D{0,12}(\d{10})\b/i) ?? m.match(/\b(\d{10})\b\D{0,12}pnr/i);
  if (pnr) return `PNR ${pnr[1]} status`;
  const flight = /\b(flight|udaan)\b/i.test(m) && m.match(/\b([A-Z0-9]{2})[ -]?(\d{2,4})\b/i);
  if (flight) return `${flight[1].toUpperCase()}${flight[2]} flight status ${today}`;
  return m;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface LiveSearchOptions {
  /** Hard cap on the whole search (ms). Default 6000. */
  timeoutMs?: number;
  /** Max results to fold in. Default 5. */
  limit?: number;
  /** Injectable search client (tests). */
  client?: Pick<WebSearch, 'search'>;
  /** Injectable clock (tests). */
  now?: Date;
  /**
   * Also READ the top result's page (admin 2026-08-25). Snippets are 2 lines; a "flight kitna late
   * hai" answer lives in the page body. Bounded by its own timeout and character cap, and any failure
   * silently degrades to snippets-only — the page read may only ever ADD grounding, never cost the
   * reply. Default true; injectable for tests.
   */
  readTopResult?: boolean;
  pageTimeoutMs?: number;
  fetchPage?: (url: string) => Promise<{ ok: boolean; text: string }>;
  /** Injectable live-transit source (tests). Defaults to the real env-gated liveTransitContext. */
  transit?: (message: string) => Promise<string>;
}

/** How much of the top result's page is folded into the chat context. A chat turn is not a build. */
export const PAGE_CONTEXT_MAX_CHARS = 3_500;

/**
 * Returns a ready-to-inject "LIVE WEB RESULTS" block for a message that needs current facts, or ''
 * when the message doesn't need it / the search found nothing / it timed out. Never throws.
 */
export async function liveSearchContext(message: string, opts: LiveSearchOptions = {}): Promise<string> {
  if (!needsLiveSearch(message)) return '';

  // REAL LIVE DATA FIRST (admin 2026-08-25: "train ki live location bhi bata de"). When the message
  // names a train/PNR/flight and a live feed is configured, its data outranks anything a search
  // snippet can say about "right now" — and when it answers, the search is skipped entirely, so the
  // live path is FASTER than the fallback, not slower. No key / no match / feed down ⇒ '' and the
  // ordinary search below runs, exactly as before.
  const transit = opts.transit ?? ((m: string) => liveTransitContext(m, { now: opts.now }));
  const liveBlock = await transit(message).catch(() => '');
  if (liveBlock) return liveBlock;

  const limit = Math.max(1, Math.min(opts.limit ?? 5, 10));
  const client = opts.client ?? new WebSearch();
  const query = shapeSearchQuery(message, opts.now ?? new Date());
  const results = await withTimeout(
    client.search(query, limit).catch(() => []),
    opts.timeoutMs ?? 6000,
    [],
  );
  if (!results || results.length === 0) return '';

  // Read the TOP page so the model has the words, not just two snippet lines. Best-effort: SSRF-guarded
  // (webFetchUrl), capped in time and size, and '' on any failure — snippets-only remains a full answer.
  let pageBlock = '';
  if (opts.readTopResult !== false && results[0]?.url) {
    const fetchPage = opts.fetchPage ?? (async (url: string) => {
      const r = await webFetchUrl(url);
      return { ok: r.ok, text: r.text };
    });
    const page = await withTimeout(
      fetchPage(results[0].url).catch(() => ({ ok: false, text: '' })),
      opts.pageTimeoutMs ?? 4000,
      { ok: false, text: '' },
    );
    if (page.ok && page.text.trim()) {
      const capped = capText(page.text.trim(), PAGE_CONTEXT_MAX_CHARS);
      pageBlock = `\n\nTOP RESULT PAGE (${results[0].url}):\n${capped.text}${capped.truncated ? '\n…(page truncated)' : ''}`;
    }
  }

  const when = (opts.now ?? new Date()).toISOString().slice(0, 10);
  return `LIVE WEB RESULTS (fetched just now, ${when}):
${formatSearchResults(query, results)}${pageBlock}

Use these CURRENT results as your PRIMARY source for anything time-sensitive in your answer — they are more up to date than your training data and override it on facts they cover. If they don't answer the question, say what you reliably know and that it may be dated. Do not mention that you searched the web unless the user asks.`;
}
