// AgentV3 — Mistake Ledger: the same mistake must never be made twice.
//
// WHAT WAS ALREADY THERE, AND WHY IT WAS NOT ENOUGH (admin ask 2026-08-06:
// "galtiyon se seekhne wala system — ek baar wali galti wapas repeat na ho").
//
// v5.0 already LEARNS: `Reflection` distils a build's errors/fixes into lessons, `BuildLessons` turns
// the build report's root cause into one concrete lesson, `UserLessonBrain` lifts proven fixes across
// a user's projects, and `RecalledLessons` injects them into the next build's prompt. Every piece is
// real and wired. But the loop had one broken link — the RECALL KEY:
//
//     const hits = lessonsMem.recall(prompt, 8);      // ← matched against the USER'S PROMPT
//
// A lesson is about a MISTAKE ("the dev server bound its port before wiring page routes, so every page
// 404'd"). A prompt is about a WISH ("home page par green dot hatao"). They share almost no words, so
// similarity search cannot connect them. The lesson was stored, ranked, and formatted beautifully —
// and then never surfaced at the one moment it mattered: when the same failure was happening again.
//
// THIS MODULE CLOSES THAT LINK, and it does it DETERMINISTICALLY rather than by similarity:
//   • a mistake is keyed by its normalized SIGNATURE (Reflection.errorSignature — reused, never
//     re-implemented, so "same error" has exactly one definition in the codebase);
//   • a fix is only recorded as PROVEN when the build that followed it actually succeeded;
//   • when an error with a known signature appears again, the proven fix is injected THERE AND THEN —
//     an exact key lookup, not a ranking that can miss;
//   • and the ledger MEASURES ITSELF: `repeatStats` reports how many mistakes recurred despite a known
//     fix. A learning system that cannot show its repeat rate is faith, not engineering — and that
//     number is the only honest answer to "did it actually stop repeating?".
//
// PURE + dependency-free: every function here is deterministic and unit-tested. Persistence and
// injection live at the call sites, so this can never break a build.

import { errorSignature } from './Reflection';

/** One mistake the engine has seen, keyed by its normalized signature. */
export interface MistakeRecord {
  /** Normalized signature — the identity of "this same failure". */
  signature: string;
  /** A short, human-readable sample of how it actually appeared. */
  sample: string;
  /** How many times this mistake has been seen, ever. */
  seen: number;
  /** Last time it was seen (ms). */
  lastSeen: number;
  /**
   * The fix that PROVED to work — recorded only when the build following it succeeded. Absent while
   * the mistake is still unsolved, which is itself useful: it marks an open wound, not a solved one.
   */
  provenFix?: string;
  /** When the fix was proven (ms). */
  fixedAt?: number;
  /**
   * How many times this mistake recurred AFTER a fix was already known. This is the number that says
   * whether the system is genuinely learning — every increment is a repeat that should not have
   * happened, and it is deliberately impossible to hide.
   */
  repeatsAfterFix: number;
}

export interface MistakeLedger {
  mistakes: MistakeRecord[];
  updatedAt?: number;
}

/** Cap the stored set so the ledger cannot grow without bound (weakest/oldest dropped). */
export const MAX_MISTAKES = 120;
/** Never inject more than this many known-fix guards into one prompt. */
export const MAX_GUARDS = 4;

export function emptyLedger(): MistakeLedger {
  return { mistakes: [] };
}

/** Trim a message to a single readable line. PURE. */
function line(text: string, max = 180): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * The identity of a mistake. Reuses `errorSignature` so "the same error" means exactly one thing
 * across Reflection, the recurring-error detector and this ledger — a second definition would drift,
 * and a drifted signature silently breaks repeat detection (the one thing this module exists for).
 */
export function mistakeKey(errorText: string): string {
  return errorSignature(errorText);
}

/**
 * Record that a mistake happened. Returns a NEW ledger (pure).
 *
 * When the mistake already has a proven fix, this increments `repeatsAfterFix` — the honest counter
 * that says the guard did not hold. It is incremented here, at the moment of truth, rather than being
 * derived later from logs that may not exist.
 */
export function recordMistake(ledger: MistakeLedger, errorText: string, ts = Date.now()): MistakeLedger {
  const signature = mistakeKey(errorText);
  if (!signature) return ledger;
  const mistakes = [...(ledger.mistakes ?? [])];
  const i = mistakes.findIndex((m) => m.signature === signature);
  if (i >= 0) {
    const prev = mistakes[i];
    mistakes[i] = {
      ...prev,
      seen: prev.seen + 1,
      lastSeen: ts,
      repeatsAfterFix: prev.provenFix ? prev.repeatsAfterFix + 1 : prev.repeatsAfterFix,
    };
  } else {
    mistakes.push({ signature, sample: line(errorText), seen: 1, lastSeen: ts, repeatsAfterFix: 0 });
  }
  return { mistakes: trim(mistakes), updatedAt: ts };
}

/**
 * Record the fix that RESOLVED a mistake — but only call this when the build genuinely succeeded.
 * A fix recorded from a build that still failed is not a fix; it is a guess, and storing guesses is
 * how a "learning" system starts confidently teaching wrong answers.
 */
export function recordProvenFix(ledger: MistakeLedger, errorText: string, fix: string, ts = Date.now()): MistakeLedger {
  const signature = mistakeKey(errorText);
  const cleanFix = line(fix, 400);
  if (!signature || !cleanFix) return ledger;
  const mistakes = [...(ledger.mistakes ?? [])];
  const i = mistakes.findIndex((m) => m.signature === signature);
  if (i >= 0) {
    mistakes[i] = { ...mistakes[i], provenFix: cleanFix, fixedAt: ts };
  } else {
    mistakes.push({ signature, sample: line(errorText), seen: 1, lastSeen: ts, provenFix: cleanFix, fixedAt: ts, repeatsAfterFix: 0 });
  }
  return { mistakes: trim(mistakes), updatedAt: ts };
}

/** Keep the ledger bounded: solved-and-recent first, then most-seen; the tail is dropped. PURE. */
function trim(mistakes: MistakeRecord[]): MistakeRecord[] {
  if (mistakes.length <= MAX_MISTAKES) return mistakes;
  const ranked = [...mistakes].sort((a, b) => {
    // A mistake with a proven fix is the most valuable thing here — it is what prevents a repeat.
    const fixDiff = Number(!!b.provenFix) - Number(!!a.provenFix);
    if (fixDiff !== 0) return fixDiff;
    if (b.seen !== a.seen) return b.seen - a.seen;
    return b.lastSeen - a.lastSeen;
  });
  return ranked.slice(0, MAX_MISTAKES);
}

/**
 * THE EXACT LOOKUP. Given an error happening RIGHT NOW, return the proven fix for it — by signature,
 * not by similarity. This is the whole difference from prompt-based recall: it cannot miss because the
 * words differ, and it cannot fire on an unrelated lesson that merely scored well.
 */
export function knownFixFor(ledger: MistakeLedger, errorText: string): MistakeRecord | null {
  const signature = mistakeKey(errorText);
  if (!signature) return null;
  const hit = (ledger.mistakes ?? []).find((m) => m.signature === signature && m.provenFix);
  return hit ?? null;
}

/**
 * The guidance block injected when a KNOWN mistake is recurring — the moment the loop finally pays off.
 * Deliberately imperative and specific: a lesson phrased as trivia ("we once had an issue with ports")
 * changes nothing, while "this exact failure has a proven fix — apply it" does. Returns '' when
 * nothing matches, so a build with no relevant history is byte-identical to today. PURE.
 */
export function formatKnownMistakes(ledger: MistakeLedger, errorTexts: string[]): string {
  const seen = new Set<string>();
  const hits: MistakeRecord[] = [];
  for (const text of errorTexts ?? []) {
    const hit = knownFixFor(ledger, text);
    if (hit && !seen.has(hit.signature)) { seen.add(hit.signature); hits.push(hit); }
    if (hits.length >= MAX_GUARDS) break;
  }
  if (hits.length === 0) return '';
  const lines = hits.map((h) => {
    const repeated = h.repeatsAfterFix > 0 ? ` (this has already come back ${h.repeatsAfterFix}× after being fixed — do not let it happen again)` : '';
    return `• You have hit this exact failure before: ${h.sample}\n  PROVEN FIX — apply it now${repeated}: ${h.provenFix}`;
  });
  return [
    'KNOWN MISTAKE — you have already solved this one. Do NOT rediscover it from scratch:',
    ...lines,
  ].join('\n');
}

/**
 * Is the engine repeating itself? The honest self-measurement.
 *
 * `repeatRate` is the share of solved mistakes that came back anyway. It exists so the answer to
 * "is the learning system actually working?" is a NUMBER from real builds, not an assurance — and so a
 * regression shows up as the rate climbing instead of hiding behind a growing lesson count. PURE.
 */
export function repeatStats(ledger: MistakeLedger): {
  total: number; solved: number; unsolved: number; repeatedAfterFix: number; repeatRate: number;
} {
  const all = ledger.mistakes ?? [];
  const solved = all.filter((m) => !!m.provenFix);
  const repeatedAfterFix = solved.filter((m) => m.repeatsAfterFix > 0).length;
  return {
    total: all.length,
    solved: solved.length,
    unsolved: all.length - solved.length,
    repeatedAfterFix,
    repeatRate: solved.length === 0 ? 0 : Math.round((repeatedAfterFix / solved.length) * 100) / 100,
  };
}

/** The mistakes that keep coming back despite a known fix — what to harden next, ranked worst-first. */
export function worstRepeats(ledger: MistakeLedger, limit = 5): MistakeRecord[] {
  return (ledger.mistakes ?? [])
    .filter((m) => m.repeatsAfterFix > 0)
    .sort((a, b) => b.repeatsAfterFix - a.repeatsAfterFix || b.lastSeen - a.lastSeen)
    .slice(0, Math.max(1, limit));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Persistence. Mirrors UserLessonBrainStore exactly (same Firestore access pattern, same fail-open
// discipline) so there is one house style for "durable per-user learning" rather than two.
//
// Per USER, not per workspace: a mistake solved in project A must not be re-made in project B. That is
// the whole point of "ek baar wali galti wapas repeat na ho" — a ledger scoped to one workspace would
// let every new project start naive again.
//
// Collection: `user_mistakes_v3/{userId}`
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

class MistakeLedgerStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (this.db) return this.db;
    try {
      this.db = getServerDb();
      return this.db;
    } catch {
      return null;
    }
  }

  /** Load a user's ledger (empty when none / unavailable). Never throws. */
  async get(userId: string | null): Promise<MistakeLedger> {
    const db = this.getDb();
    if (!db || !userId) return emptyLedger();
    try {
      const snap = await db.collection('user_mistakes_v3').doc(userId).get();
      const data = snap.exists ? (snap.data() as MistakeLedger) : null;
      return data && Array.isArray(data.mistakes) ? data : emptyLedger();
    } catch {
      return emptyLedger();
    }
  }

  /**
   * The guidance block for the errors this project has ALREADY hit — '' when none match, so a build
   * with no relevant history is byte-identical to today. Never throws.
   */
  async guardFor(userId: string | null, errorTexts: string[]): Promise<string> {
    try {
      if (!userId || !errorTexts?.length) return '';
      return formatKnownMistakes(await this.get(userId), errorTexts);
    } catch {
      return '';
    }
  }

  /**
   * Fold one build's outcome into the ledger.
   *
   * The PROVEN-FIX rule lives here, in one place: a fix is only recorded when the build actually
   * SUCCEEDED. A "fix" harvested from a build that still failed is a guess, and a learning system that
   * stores guesses starts confidently teaching wrong answers — the failure mode that would make this
   * whole feature worse than having none.
   */
  async recordBuild(
    userId: string | null,
    input: { ok: boolean; errors: string[]; fix?: string | null },
    ts = Date.now(),
  ): Promise<MistakeLedger | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    const errors = (input.errors ?? []).filter((e) => typeof e === 'string' && e.trim());
    if (errors.length === 0) return null; // a clean build teaches nothing — never churn the doc
    try {
      const ref = db.collection('user_mistakes_v3').doc(userId);
      const snap = await ref.get();
      let ledger: MistakeLedger = snap.exists ? (snap.data() as MistakeLedger) : emptyLedger();
      if (!Array.isArray(ledger.mistakes)) ledger = emptyLedger();
      for (const e of errors) ledger = recordMistake(ledger, e, ts);
      if (input.ok && input.fix && input.fix.trim()) {
        for (const e of errors) ledger = recordProvenFix(ledger, e, input.fix, ts);
      }
      await ref.set(ledger, { merge: false });
      return ledger;
    } catch (err) {
      console.error('[MISTAKE-LEDGER] recordBuild failed:', err);
      return null;
    }
  }
}

export const mistakeLedgerStore = new MistakeLedgerStore();
