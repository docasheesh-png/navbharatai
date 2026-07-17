// Offline AI — a 100% on-device app guide (admin 2026-07-16). Works with NO internet: it is grounded
// entirely in APP_KNOWLEDGE_BASE, which is pure data bundled into the client, so it always knows EVERY
// NavBharatAI feature — where the button is, what it does, how to use it — with ZERO hallucination (it
// only ever returns real KB facts, never a guessed answer). Because it reads the same single source of
// truth every AI reads, any feature added to the KB (mandatory per CLAUDE.md for every new feature)
// AUTOMATICALLY becomes answerable here — no separate sync. Retrieval-only + pure → unit-testable and
// instant; it needs no model download and no network.
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

// Signals that the user wants a broad "what can this app do / show me everything" tour.
const OVERVIEW_SIGNALS = [
  'what can', 'what all', 'everything', 'all features', 'features list', 'list features', 'show me all',
  'kya kya', 'sab kuch', 'sari features', 'saari features', 'poori app', 'app me kya', 'app kya karti',
  'help', 'madad', 'guide', 'kaha se shuru', 'where to start', 'get started',
];

/** Score one feature against a normalized query. Mirrors the server AppContextInjector weighting so the
 *  offline guide ranks the same way the online AIs do. Pure. */
export function scoreFeature(f: AppFeature, msg: string): number {
  let score = 0;
  for (const kw of f.keywords || []) {
    if (kw && msg.includes(norm(kw))) score += kw.includes(' ') ? 3 : 2;
  }
  if (f.name && msg.includes(norm(f.name))) score += 4;
  // A word-boundary hit on any query token inside the description is a weak signal.
  const words = msg.split(/\s+/).filter((w) => w.length >= 4);
  const descr = norm(f.description);
  for (const w of words) if (descr.includes(w)) score += 1;
  return score;
}

/** Rank features for a query (best first, score > 0). Pure. */
export function searchFeatures(query: string, limit = 6): OfflineMatch[] {
  const msg = norm(query);
  if (!msg) return [];
  return APP_KNOWLEDGE_BASE
    .map((f) => ({ feature: f, score: scoreFeature(f, msg) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
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

/** The howToUse text as clean, numbered-friendly steps (splits on "1. 2." or sentences). Pure. */
export function howToSteps(howToUse: string): string[] {
  const t = String(howToUse || '').trim();
  if (!t) return [];
  const byNumber = t.split(/\s*(?:\d+\.\s+)/).map((s) => s.trim()).filter(Boolean);
  if (byNumber.length > 1) return byNumber;
  return t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
