// AgentV3 — P-AI.5 Preference Learning / Personalization.
//
// The AI used to treat every user identically. This store learns each user's REVEALED
// preferences from their SUCCESSFUL builds (never from explicit input — inferred from the
// blueprint/files that actually shipped) and feeds the dominant stack back into the Architect
// system prompt for returning users, so "this user always picks React + Tailwind + Firestore"
// becomes a real, felt bias in what the AI proposes next.
//
// Design:
// - PURE CORE (inferPreferences / mergePreferences / topPreferences / preferenceContext) — fully
//   unit-tested, no I/O, deterministic. The Firestore persistence wraps that core.
// - High-precision inference: only count a signal when the evidence is strong (a real dependency
//   in package.json, an unambiguous import). A wrong guess would steer the AI wrong, so when unsure
//   we record nothing rather than a bad signal.
// - NEVER blocks a build: every persistence call is best-effort and swallows errors. A returning
//   user with no learned data simply gets the normal prompt (no injected context).
//
// Collection: `userPrefs/{userId}`

import * as admin from 'firebase-admin';

/** A single build's observed (inferred) choices. Any field may be null when not detectable. */
export interface ObservedPreferences {
  framework: string | null;
  database: string | null;
  styling: string | null;
  language: 'typescript' | 'javascript' | null;
  /** A short, human-readable signature of what kind of app this was (from the prompt). */
  pattern: string | null;
}

/** A tally: value → count, for picking the user's most-frequent choice. */
export type Tally = Record<string, number>;

/** The durable, accumulated preference record persisted per user. */
export interface StoredPreferences {
  frameworks: Tally;
  databases: Tally;
  styles: Tally;
  languages: Tally;
  /** Most-recent-first signatures of the last few successful builds (capped). */
  recentPatterns: string[];
  /** Number of successful builds folded into this record. */
  totalBuilds: number;
  updatedAt?: string;
}

/** The dominant choice in each dimension (the mode), or null when there is no data. */
export interface TopPreferences {
  framework: string | null;
  database: string | null;
  styling: string | null;
  language: string | null;
  totalBuilds: number;
}

const MAX_RECENT_PATTERNS = 5;
/** Inject learned context only once a real pattern exists (≥ this many prior successful builds). */
export const MIN_BUILDS_FOR_CONTEXT = 2;

function emptyStored(): StoredPreferences {
  return { frameworks: {}, databases: {}, styles: {}, languages: {}, recentPatterns: [], totalBuilds: 0 };
}

/** Concatenate every file's content (bounded) so detectors can scan the whole blueprint cheaply. */
function joinFiles(files: Record<string, string>): string {
  let out = '';
  for (const c of Object.values(files)) {
    if (typeof c === 'string') out += c + '\n';
    if (out.length > 400_000) break; // bound: never scan an unbounded blob
  }
  return out;
}

/** Parse a package.json blob into a flat name→version dep map (deps + devDeps). Tolerant. */
function readDeps(files: Record<string, string>): Record<string, string> {
  const pkg = files['package.json'] ?? files['/package.json'];
  if (!pkg) return {};
  try {
    const json = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
  } catch {
    return {};
  }
}

/** Detect the database / persistence choice from dependencies + code (high precision). */
export function detectDatabase(files: Record<string, string>): string | null {
  const deps = readDeps(files);
  const has = (n: string) => Object.prototype.hasOwnProperty.call(deps, n);
  if (has('firebase') || has('firebase-admin')) return 'firestore';
  if (has('@supabase/supabase-js')) return 'supabase';
  if (has('@prisma/client') || has('prisma')) return 'prisma';
  if (has('mongoose') || has('mongodb')) return 'mongodb';
  if (has('pg') || has('postgres')) return 'postgres';
  if (has('mysql') || has('mysql2')) return 'mysql';
  if (has('better-sqlite3') || has('sqlite3')) return 'sqlite';
  // Fall back to a clear import in code when no dependency map was provided.
  const code = joinFiles(files);
  if (/from\s+['"]firebase(\/|['"])/.test(code)) return 'firestore';
  if (/from\s+['"]@supabase\/supabase-js['"]/.test(code)) return 'supabase';
  return null;
}

/** Detect the styling approach from dependencies + code. */
export function detectStyling(files: Record<string, string>): string | null {
  const deps = readDeps(files);
  const has = (n: string) => Object.prototype.hasOwnProperty.call(deps, n);
  if (has('tailwindcss') || files['tailwind.config.js'] || files['tailwind.config.ts']) return 'tailwind';
  if (has('styled-components')) return 'styled-components';
  if (has('@emotion/react') || has('@emotion/styled')) return 'emotion';
  if (has('@mui/material')) return 'mui';
  if (has('@chakra-ui/react')) return 'chakra';
  if (has('sass')) return 'sass';
  // CSS Modules: a *.module.css file present.
  if (Object.keys(files).some((p) => /\.module\.(css|scss)$/.test(p))) return 'css-modules';
  return null;
}

/** Detect TypeScript vs JavaScript from file extensions / tsconfig. */
export function detectLanguage(files: Record<string, string>): 'typescript' | 'javascript' | null {
  const paths = Object.keys(files);
  if (paths.some((p) => p === 'tsconfig.json' || /\.tsx?$/.test(p))) return 'typescript';
  if (paths.some((p) => /\.jsx?$/.test(p))) return 'javascript';
  return null;
}

const PATTERN_KEYWORDS: Array<{ label: string; re: RegExp }> = [
  { label: 'e-commerce', re: /\b(e-?commerce|shop|store|cart|checkout|product\s+catalog)\b/i },
  { label: 'dashboard', re: /\b(dashboard|admin\s+panel|analytics|metrics)\b/i },
  { label: 'blog', re: /\b(blog|cms|article|content\s+site)\b/i },
  { label: 'social', re: /\b(social|feed|chat|messaging|community|forum)\b/i },
  { label: 'todo/productivity', re: /\b(todo|task\s+manager|kanban|notes?\s+app|productivity)\b/i },
  { label: 'landing page', re: /\b(landing\s+page|marketing\s+site|portfolio|one-?pager)\b/i },
  { label: 'saas', re: /\b(saas|subscription|billing|multi-?tenant)\b/i },
  { label: 'booking', re: /\b(booking|reservation|appointment|scheduling)\b/i },
  { label: 'CRM', re: /\b(crm|contacts?|leads?|deals?\s+pipeline)\b/i },
];

/** Reduce a build prompt to a short app-type signature (or null if nothing recognizable). */
export function summarizePattern(prompt: string | null | undefined): string | null {
  const text = String(prompt || '');
  if (!text.trim()) return null;
  for (const { label, re } of PATTERN_KEYWORDS) if (re.test(text)) return label;
  return null;
}

/** Infer one build's preferences from the produced files + framework + prompt. Pure. */
export function inferPreferences(input: {
  framework?: string | null;
  files?: Record<string, string> | null;
  prompt?: string | null;
}): ObservedPreferences {
  const files = input.files || {};
  return {
    framework: input.framework && input.framework.trim() ? input.framework : null,
    database: detectDatabase(files),
    styling: detectStyling(files),
    language: detectLanguage(files),
    pattern: summarizePattern(input.prompt),
  };
}

function bump(tally: Tally, key: string | null): void {
  if (!key) return;
  tally[key] = (tally[key] || 0) + 1;
}

/** Fold one build's observations into the durable record. Pure — returns a NEW record. */
export function mergePreferences(
  stored: StoredPreferences | null | undefined,
  observed: ObservedPreferences,
  nowIso: string,
): StoredPreferences {
  const base = stored ? { ...stored } : emptyStored();
  const next: StoredPreferences = {
    frameworks: { ...base.frameworks },
    databases: { ...base.databases },
    styles: { ...base.styles },
    languages: { ...base.languages },
    recentPatterns: [...(base.recentPatterns || [])],
    totalBuilds: (base.totalBuilds || 0) + 1,
    updatedAt: nowIso,
  };
  bump(next.frameworks, observed.framework);
  bump(next.databases, observed.database);
  bump(next.styles, observed.styling);
  bump(next.languages, observed.language);
  if (observed.pattern) {
    // Most-recent-first, de-duplicated, capped.
    next.recentPatterns = [observed.pattern, ...next.recentPatterns.filter((p) => p !== observed.pattern)].slice(
      0,
      MAX_RECENT_PATTERNS,
    );
  }
  return next;
}

/** The most-frequent value in a tally (ties broken by first-seen insertion order). */
function mode(tally: Tally): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [k, c] of Object.entries(tally)) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

/** The dominant choice in each dimension. Pure. */
export function topPreferences(stored: StoredPreferences | null | undefined): TopPreferences {
  const s = stored || emptyStored();
  return {
    framework: mode(s.frameworks),
    database: mode(s.databases),
    styling: mode(s.styles),
    language: mode(s.languages),
    totalBuilds: s.totalBuilds || 0,
  };
}

/**
 * Render the learned preferences as a concise context block for the Architect system prompt, or
 * '' when there isn't enough history to be confident. Pure — safe to inline into the prompt.
 * The block is ADVISORY (a default the user can always override in their request), never a mandate.
 */
export function preferenceContext(stored: StoredPreferences | null | undefined): string {
  const s = stored || emptyStored();
  if ((s.totalBuilds || 0) < MIN_BUILDS_FOR_CONTEXT) return '';
  const top = topPreferences(s);
  const lines: string[] = [];
  if (top.framework) lines.push(`- Preferred framework: ${top.framework}`);
  if (top.database) lines.push(`- Preferred database/persistence: ${top.database}`);
  if (top.styling) lines.push(`- Preferred styling: ${top.styling}`);
  if (top.language) lines.push(`- Preferred language: ${top.language}`);
  if (s.recentPatterns && s.recentPatterns.length > 0) {
    lines.push(`- Recently built: ${s.recentPatterns.join(', ')}`);
  }
  if (lines.length === 0) return '';
  return [
    'RETURNING USER — LEARNED PREFERENCES (advisory defaults inferred from this user\'s past',
    `successful builds across ${top.totalBuilds} build${top.totalBuilds === 1 ? '' : 's'}). When the user`,
    "does NOT specify a stack, lean toward these choices — they match how this user likes to build.",
    'If the user explicitly asks for something different, follow the user; these are defaults, not rules.',
    ...lines,
  ].join('\n');
}

/**
 * Firestore-backed persistence around the pure core. VITEST-skip, best-effort, never throws —
 * mirrors ProviderStateStore / UserCostStore.
 */
class UserPreferenceStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = admin.firestore();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  /** Load a user's learned preferences (null when none / unavailable). */
  async get(userId: string | null): Promise<StoredPreferences | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    try {
      const snap = await db.collection('userPrefs').doc(userId).get();
      return snap.exists ? (snap.data() as StoredPreferences) : null;
    } catch {
      return null;
    }
  }

  /** Load and render the injectable context block in one call ('' when none). Never throws. */
  async contextFor(userId: string | null): Promise<string> {
    try {
      return preferenceContext(await this.get(userId));
    } catch {
      return '';
    }
  }

  /**
   * Record one SUCCESSFUL build: infer its preferences and fold them into the user's record.
   * Best-effort — returns the updated record when written, null otherwise. Never throws.
   */
  async recordBuild(
    userId: string | null,
    input: { framework?: string | null; files?: Record<string, string> | null; prompt?: string | null },
    nowIso: string,
  ): Promise<StoredPreferences | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    try {
      const observed = inferPreferences(input);
      // Nothing learnable → don't write an empty build.
      if (!observed.framework && !observed.database && !observed.styling && !observed.language && !observed.pattern) {
        return null;
      }
      const ref = db.collection('userPrefs').doc(userId);
      // Read-modify-write inside a TRANSACTION. Without it, two builds finishing near-simultaneously
      // for the same user (two tabs) both read the same `prev`, and the second `set(merge:false)`
      // clobbers the first — permanently dropping a build's learned signal + totalBuilds increment.
      const next = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? (snap.data() as StoredPreferences) : null;
        const merged = mergePreferences(prev, observed, nowIso);
        tx.set(ref, merged, { merge: false });
        return merged;
      });
      return next;
    } catch (err) {
      console.error('[USER-PREF] recordBuild failed:', err);
      return null;
    }
  }
}

export const userPreferenceStore = new UserPreferenceStore();
