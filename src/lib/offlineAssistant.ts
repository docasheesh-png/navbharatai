// Offline AI — a 100% on-device app guide (admin 2026-07-16, enhanced 2026-07-18). Works with NO
// internet: it is grounded entirely in APP_KNOWLEDGE_BASE, which is pure data bundled into the client,
// so it always knows EVERY NavBharatAI feature — where the button is, what it does, how to use it —
// with ZERO hallucination (it only ever returns real KB facts, never a guessed answer). Because it
// reads the same single source of truth every AI reads, any feature added to the KB (mandatory per
// CLAUDE.md for every new feature) AUTOMATICALLY becomes answerable here — no separate sync.
// Retrieval-only + pure → unit-testable and instant; it needs no model download and no network.
//
// ENHANCEMENT (2026-07-18): because there is NO server to fall back to when offline, a query the exact
// matcher misses is a dead end. So retrieval now has a TYPO-TOLERANT fuzzy fallback tier (bounded edit
// distance) that recovers near-miss words like "databse" / "walet" / "deploi" — scored strictly BELOW
// exact hits, so every query that already worked ranks exactly as before. It also resolves each result's
// related features and offers starter suggestions, all from the same real KB data.
//
// HONESTY: this is an app GUIDE, not the full engine. Building apps and full Pro chat need the online
// engine (server + big models) — the UI says so and points the user online for those.

import { APP_KNOWLEDGE_BASE, type AppFeature } from '../server/AppContext/AppKnowledgeBase';

export interface OfflineMatch {
  feature: AppFeature;
  score: number;
}

export interface OfflineAnswer {
  /** 'overview' — a whole-app tour; 'matches' — features for a specific query; 'none' — nothing found. */
  kind: 'overview' | 'matches' | 'none';
  /** A short natural lead-in shown above the cards. */
  lead: string;
  /** The matched features (best first). Empty for 'none'. */
  matches: AppFeature[];
}

const norm = (s: string): string => String(s || '').toLowerCase().trim();

/** Split text into lowercase word tokens (letters/digits only). Pure. */
function tokens(s: string): string[] {
  return norm(s).split(/[^a-z0-9]+/i).filter(Boolean);
}

/**
 * Bounded Levenshtein edit distance. Returns the true distance when it is ≤ `max`, otherwise returns
 * `max + 1` (an early-exit sentinel — we never care about the exact value once it exceeds the budget).
 * Pure and allocation-light (two rolling rows). Used only for the typo-tolerant fallback tier.
 */
export function editDistance(a: string, b: string, max = 2): number {
  a = norm(a);
  b = norm(b);
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = new Array<number>(bl + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    // If the entire row already exceeds the budget, no completion can come back under it.
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[bl] <= max ? prev[bl] : max + 1;
}

/** A query token fuzzily matches a target token when it is one/two small typos away. Only longer words
 *  are fuzzed (short words are too collision-prone), and the edit budget scales with length. Pure. */
function fuzzyTokenHit(queryTok: string, targetTok: string): boolean {
  if (queryTok.length < 4 || targetTok.length < 4) return false;
  if (Math.abs(queryTok.length - targetTok.length) > 2) return false;
  const budget = queryTok.length >= 7 ? 2 : 1;
  return editDistance(queryTok, targetTok, budget) <= budget;
}

/** The set of individual keyword + name words (length ≥ 4) a feature can be fuzzily matched against. Pure. */
function fuzzyTargets(f: AppFeature): Set<string> {
  const out = new Set<string>();
  for (const kw of f.keywords || []) for (const t of tokens(kw)) if (t.length >= 4) out.add(t);
  for (const t of tokens(f.name)) if (t.length >= 4) out.add(t);
  return out;
}

// Signals that the user wants a broad "what can this app do / show me everything" tour.
const OVERVIEW_SIGNALS = [
  'what can', 'what all', 'everything', 'all features', 'features list', 'list features', 'show me all',
  'kya kya', 'sab kuch', 'sari features', 'saari features', 'poori app', 'app me kya', 'app kya karti',
  'help', 'madad', 'guide', 'kaha se shuru', 'where to start', 'get started',
];

/** Score one feature against a normalized query. Mirrors the server AppContextInjector weighting so the
 *  offline guide ranks the same way the online AIs do, then adds a typo-tolerant fallback tier that is
 *  always scored BELOW the exact tiers (so a real hit can never be outranked by a fuzzy one). Pure. */
export function scoreFeature(f: AppFeature, msg: string): number {
  let score = 0;
  for (const kw of f.keywords || []) {
    if (kw && msg.includes(norm(kw))) score += kw.includes(' ') ? 3 : 2;
  }
  if (f.name && msg.includes(norm(f.name))) score += 4;
  // A word-boundary hit on any query token inside the description is a weak signal. (Word-boundary via a
  // token set — a substring check would falsely fire "art" inside "start".)
  const qWords = tokens(msg).filter((w) => w.length >= 4);
  const descTokens = new Set(tokens(f.description));
  for (const w of qWords) if (descTokens.has(w)) score += 1;
  // TYPO-TOLERANT FALLBACK — recover near-miss words the exact tiers missed. Weighted at 1.5, strictly
  // below an exact single-keyword hit (2), so it only ever surfaces results that would otherwise be lost.
  const targets = fuzzyTargets(f);
  for (const w of qWords) {
    if (targets.has(w)) continue; // already counted as an exact token hit above
    for (const t of targets) {
      if (fuzzyTokenHit(w, t)) { score += 1.5; break; }
    }
  }
  return score;
}

/** How many DISTINCT query words (length ≥ 4) this feature matches — via keyword/name tokens, a
 *  description word, a multi-word keyword phrase, or the typo-tolerant fallback. Breadth of coverage is
 *  the relevance tie-breaker: a feature that answers more of the user's actual words is more relevant
 *  than one matched on a single generic word. Pure. */
export function matchCoverage(f: AppFeature, msg: string): number {
  const qWords = tokens(msg).filter((w) => w.length >= 4);
  if (!qWords.length) return 0;
  const kwTokens = fuzzyTargets(f); // keyword + name words (length ≥ 4)
  const descTokens = new Set(tokens(f.description));
  const phrases = (f.keywords || []).filter((k) => k.includes(' ')).map(norm);
  let n = 0;
  for (const w of qWords) {
    let hit = kwTokens.has(w) || descTokens.has(w) || phrases.some((p) => p.includes(w));
    if (!hit) for (const t of kwTokens) if (fuzzyTokenHit(w, t)) { hit = true; break; }
    if (hit) n++;
  }
  return n;
}

/** Rank features for a query (best first, score > 0). Ties on score break by how many of the user's
 *  distinct words the feature covers (breadth of relevance), so a specific multi-term match outranks a
 *  feature that only caught one generic word. Pure. */
export function searchFeatures(query: string, limit = 6): OfflineMatch[] {
  const msg = norm(query);
  if (!msg) return [];
  return APP_KNOWLEDGE_BASE
    .map((f) => ({ feature: f, score: scoreFeature(f, msg), coverage: matchCoverage(f, msg) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage)
    .map(({ feature, score }) => ({ feature, score }))
    .slice(0, limit);
}

function isOverviewQuery(msg: string): boolean {
  return OVERVIEW_SIGNALS.some((s) => msg.includes(s));
}

/** The curated tour shown for a broad/empty/"what can you do" query — the app's headline surfaces. */
function overviewFeatures(): AppFeature[] {
  const wantIds = [
    'agentv3_builder', 'nbi_chat', 'professionals', 'download_app', 'support_contact',
    'billing', 'agentv3_github_import', 'agentv3_export',
  ];
  const byId = new Map(APP_KNOWLEDGE_BASE.map((f) => [f.id, f]));
  const picked = wantIds.map((id) => byId.get(id)).filter(Boolean) as AppFeature[];
  // Top up to 8 with the first entries if any curated id is missing (KB drift-safe).
  for (const f of APP_KNOWLEDGE_BASE) { if (picked.length >= 8) break; if (!picked.includes(f)) picked.push(f); }
  return picked.slice(0, 8);
}

/**
 * Answer a user's offline question purely from the app knowledge base. Never invents — returns the real
 * features (with their exact path / howToUse / nav) or an honest "not found". Pure.
 */
export function answerOffline(query: string): OfflineAnswer {
  const msg = norm(query);
  if (!msg || isOverviewQuery(msg)) {
    return {
      kind: 'overview',
      lead: 'Here\'s what NavBharatAI can do — tap any card to open it, or ask me "where is X / how do I Y".',
      matches: overviewFeatures(),
    };
  }
  const matches = searchFeatures(msg).map((m) => m.feature);
  if (matches.length === 0) {
    return {
      kind: 'none',
      lead: 'I couldn\'t find that in NavBharatAI. Try different words (e.g. "database", "deploy", "wallet"), or ask "what can this app do".',
      matches: [],
    };
  }
  return {
    kind: 'matches',
    lead: matches.length === 1 ? 'Here it is:' : `Found ${matches.length} matching feature${matches.length > 1 ? 's' : ''}:`,
    matches,
  };
}

export interface NavTarget { view?: string; settingsScreen?: string }

// Curated id → in-app target for the headline features, so the Offline AI can render a WORKING
// "Open →" button today without hand-editing all 180 KB entries. A feature's OWN `nav` field (added
// to its KB entry) always WINS — so any future feature gets a working jump the moment its entry sets
// `nav`, and this map is only the fallback for the core surfaces that already exist.
const CURATED_NAV: Record<string, NavTarget> = {
  agentv3_builder: { view: 'nbi_pro_chat' },
  agentv3_export: { view: 'nbi_pro_chat' },
  agentv3_github_import: { view: 'nbi_pro_chat' },
  agentv3_zip_import: { view: 'nbi_pro_chat' },
  nbi_chat: { view: 'nbi_chat' },
  nbi_pro_chat: { view: 'nbi_pro_chat' },
  professionals: { view: 'professionals' },
  billing: { view: 'billing' },
  git: { view: 'git' },
  history: { view: 'history' },
  files: { view: 'files' },
  preview: { view: 'preview' },
  studio: { view: 'studio' },
  offline_ai: { view: 'offline_ai' },
  support_contact: { view: 'settings', settingsScreen: 'root' },
  'admin-metrics': { view: 'settings', settingsScreen: 'metrics' },
  general_settings: { view: 'settings', settingsScreen: 'general' },
  database: { view: 'settings', settingsScreen: 'database' },
  connections: { view: 'settings', settingsScreen: 'connections' },
  secrets: { view: 'settings', settingsScreen: 'secrets' },
};

/** The direct-navigation target for a feature: its own KB `nav` first, else the curated fallback, else
 *  null (the UI then shows the textual `path` as honest guidance — never a dead button). Pure. */
export function navFor(feature: AppFeature): NavTarget | null {
  const own = feature.nav;
  if (own && (own.view || own.settingsScreen)) return own;
  return CURATED_NAV[feature.id] ?? null;
}

const KB_BY_ID = new Map(APP_KNOWLEDGE_BASE.map((f) => [f.id, f]));

/** Resolve a feature's `relatedFeatures` ids to their real KB entries (drops any dangling id, and never
 *  returns the feature itself). Powers the "Related" chips so the user can hop across connected features
 *  without retyping. Pure, and always real KB data — no fabrication. */
export function relatedFeaturesOf(feature: AppFeature, limit = 4): AppFeature[] {
  const out: AppFeature[] = [];
  for (const id of feature.relatedFeatures || []) {
    if (id === feature.id) continue;
    const f = KB_BY_ID.get(id);
    if (f && !out.includes(f)) out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

/** A few real starter questions shown when the box is empty or a search comes up short, so the user
 *  always has a next tap. Each `query` resolves to a real KB result. Pure/static. */
export const SUGGESTED_QUERIES: { label: string; query: string }[] = [
  { label: 'Build an app', query: 'build an app' },
  { label: 'Wallet & billing', query: 'wallet billing' },
  { label: 'Database', query: 'database' },
  { label: 'Deploy', query: 'deploy' },
  { label: 'Import from GitHub', query: 'import from github' },
  { label: 'Voice chat', query: 'voice chat' },
  { label: 'Professionals', query: 'professionals' },
  { label: 'Download the app', query: 'download app' },
];

/** The howToUse text as clean, numbered-friendly steps (splits on "1. 2." or sentences). Pure. */
export function howToSteps(howToUse: string): string[] {
  const t = String(howToUse || '').trim();
  if (!t) return [];
  const byNumber = t.split(/\s*(?:\d+\.\s+)/).map((s) => s.trim()).filter(Boolean);
  if (byNumber.length > 1) return byNumber;
  return t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
