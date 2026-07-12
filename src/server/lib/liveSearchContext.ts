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

/** Fresh-fact signals in English + Hindi/Hinglish. Kept deliberately specific to avoid over-searching. */
const FRESH_SIGNAL =
  /\b(latest|newest|new(?:est)?\s+version|current(?:ly)?|today'?s?|tonight|right now|recent(?:ly)?|this\s+(?:year|month|week)|these days|breaking|news|headline|update[ds]?|released?|launch(?:ed|ing)?|score|scores|result|results|won|winner|winning|champion|final|tournament|series|match|squad|line-?up|captain|standings?|ranking|price|prices|rate|rates|cost|stock|shares?|market|who\s+(?:is|won|are|holds|leads)|weather|temperature|forecast|20(?:2[4-9]|3\d))\b/i;

/** Hindi / Devanagari fresh-fact signals. */
const FRESH_SIGNAL_HI =
  /(आज|अभी|ताज़ा|ताजा|इस\s*साल|आजकल|अभी\s*का|नया|नई|नये|खबर|समाचार|स्कोर|कीमत|रेट|भाव|कौन\s*(?:है|जीता|जीती|हैं)|किसने|कितना|कितने|वर्तमान|हाल\s*(?:ही|का))/;

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
  return FRESH_SIGNAL.test(m) || FRESH_SIGNAL_HI.test(m);
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
}

/**
 * Returns a ready-to-inject "LIVE WEB RESULTS" block for a message that needs current facts, or ''
 * when the message doesn't need it / the search found nothing / it timed out. Never throws.
 */
export async function liveSearchContext(message: string, opts: LiveSearchOptions = {}): Promise<string> {
  if (!needsLiveSearch(message)) return '';
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 10));
  const client = opts.client ?? new WebSearch();
  const results = await withTimeout(
    client.search(message, limit).catch(() => []),
    opts.timeoutMs ?? 6000,
    [],
  );
  if (!results || results.length === 0) return '';
  const when = (opts.now ?? new Date()).toISOString().slice(0, 10);
  return `LIVE WEB RESULTS (fetched just now, ${when}):
${formatSearchResults(message, results)}

Use these CURRENT results as your PRIMARY source for anything time-sensitive in your answer — they are more up to date than your training data and override it on facts they cover. If they don't answer the question, say what you reliably know and that it may be dated. Do not mention that you searched the web unless the user asks.`;
}
