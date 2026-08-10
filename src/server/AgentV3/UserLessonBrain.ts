// AgentV3 — Cross-Project User Lesson Brain.
//
// WorkspaceMemory + RecalledLessons close the learning loop WITHIN one workspace: a lesson learned
// in project A ("the scaffold must declare tailwindcss", "use the react-router-dom v6 API") helps
// later builds of project A. But a brand-new project B started nothing about it. This module lifts a
// user's HIGHEST-SIGNAL, TRANSFERABLE lessons — the things that actually WORKED (proven `fix`es) and
// the reflection `note`s — into a per-USER brain that is injected into EVERY new build, so accumulated
// engineering wisdom carries across all of that user's projects. UserPreferenceStore already does this
// for stack PREFERENCES (framework/db/styling); this is the equivalent for LESSONS.
//
// Design (mirrors UserPreferenceStore):
// - PURE CORE (extractPromotableLessons / mergeLessonsIntoBrain / formatBrainLessons) — fully
//   unit-tested, deterministic, no I/O. Reuses KnowledgeEvolution's dedup/conflict/confidence engine
//   so there is ONE definition of "same lesson" / "contradiction" / "trustworthiness".
// - High-signal only: ONLY `fix` (proven to work) and reflection `note`s are promoted — never raw
//   `error` symptoms (project-specific noise) or PLAN_STATE/request bookkeeping.
// - Bounded: the stored set is capped (weakest-confidence dropped) so the doc never grows unbounded.
// - NEVER blocks a build: every persistence call is best-effort and swallows errors.
//
// Collection: `user_brain_v3/{userId}`

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import {
  normalizeLessonText,
  isNearDuplicate,
  isConflict,
  lessonConfidence,
} from './KnowledgeEvolution';
import { formatLessonBlock } from './LessonBlock';
import type { Episode } from './WorkspaceMemory';

/** The transferable polarity a brain lesson can hold (only proven fixes + reflections are kept). */
export type BrainLessonKind = 'fix' | 'note';

export interface BrainLesson {
  text: string;
  kind: BrainLessonKind;
  /** Last time this lesson was seen (ms). */
  ts: number;
  /** How many independent builds confirmed it (drives confidence). */
  reinforced: number;
}

export interface UserBrain {
  lessons: BrainLesson[];
  /** Number of builds that CONTRIBUTED a lesson to this brain (a build that taught nothing is not counted). */
  totalBuilds: number;
  updatedAt?: string;
}

/** A lesson observed in one build, before it is folded into the durable brain. */
export interface IncomingLesson {
  text: string;
  kind: BrainLessonKind;
  ts: number;
}

const MAX_BRAIN_LESSONS = 60;     // cap the stored set (weakest-confidence dropped)
const MAX_PROMOTED_PER_BUILD = 12; // don't fold an unbounded number of fixes from one build
/** Don't inject cross-project lessons until there is real history (≥ this many contributing builds). */
export const MIN_BUILDS_FOR_BRAIN = 2;

const HEADER =
  'Lessons from YOUR PAST PROJECTS (cross-project memory — what worked before; apply it, avoid past mistakes):';

export function emptyBrain(): UserBrain {
  return { lessons: [], totalBuilds: 0 };
}

/** Confidence of a brain lesson = outcome weight (fix>note) + reinforcement. */
function brainConfidence(l: BrainLesson): number {
  return lessonConfidence({ text: l.text, score: 0, kind: l.kind }, l.reinforced);
}

/**
 * Extract the transferable lessons from one build's episodes: proven `fix`es and reflection `note`s
 * only (never raw `error`s, PLAN_STATE bookkeeping, or requests). Most-recent-first, capped. PURE.
 */
export function extractPromotableLessons(episodes: readonly Episode[]): IncomingLesson[] {
  if (!Array.isArray(episodes)) return [];
  const out: IncomingLesson[] = [];
  // Newest first so the cap keeps the freshest signal.
  for (let i = episodes.length - 1; i >= 0 && out.length < MAX_PROMOTED_PER_BUILD; i--) {
    const e = episodes[i];
    if (!e || (e.kind !== 'fix' && e.kind !== 'note')) continue;
    const text = typeof e.text === 'string' ? e.text.trim() : '';
    if (!text) continue;
    // Skip internal bookkeeping notes that are not real lessons.
    if (/^PLAN_STATE\b/.test(text)) continue;
    out.push({ text, kind: e.kind, ts: typeof e.ts === 'number' ? e.ts : 0 });
  }
  return out;
}

/**
 * Fold one build's lessons into the durable brain: near-duplicates REINFORCE an existing lesson
 * (and a proven `fix` upgrades a `note` of the same claim), contradictions let the NEWER advice win,
 * and the set is capped to the highest-confidence lessons. Pure — returns a NEW brain. Carries the
 * stored reinforcement counts forward (it does not reset them like a one-shot recall would).
 */
export function mergeLessonsIntoBrain(
  brain: UserBrain | null | undefined,
  incoming: readonly IncomingLesson[],
  nowIso: string,
): UserBrain {
  const base = brain && Array.isArray(brain.lessons) ? brain : emptyBrain();
  const fallbackTs = Date.parse(nowIso) || 0;
  const kept = base.lessons
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .map((l) => ({ l: { ...l }, norm: normalizeLessonText(l.text) }))
    .filter((x) => x.norm);

  for (const inc of incoming || []) {
    const text = typeof inc?.text === 'string' ? inc.text.trim() : '';
    if (!text) continue;
    const norm = normalizeLessonText(text);
    if (!norm) continue;
    const kind: BrainLessonKind = inc.kind === 'fix' ? 'fix' : 'note';
    const ts = typeof inc.ts === 'number' && inc.ts > 0 ? inc.ts : fallbackTs;

    let merged = false;
    for (const ke of kept) {
      if (isNearDuplicate(norm, ke.norm)) {
        // Same lesson again → reinforce. When the incoming is newer, adopt its (fresher) phrasing —
        // this also handles "use X" vs the later "do not use X", which the containment check treats
        // as a near-duplicate: the newer wording wins so stale advice is never shown. A proven fix
        // upgrades a mere note of the same claim.
        ke.l.reinforced += 1;
        if (ts >= ke.l.ts) {
          ke.l.text = text;
          ke.l.ts = ts;
          ke.norm = norm;
        }
        if (kind === 'fix') ke.l.kind = 'fix';
        merged = true;
        break;
      }
      if (isConflict(norm, ke.norm)) {
        // Contradiction → newer advice wins; a fresh claim, so confirmations reset.
        if (ts >= ke.l.ts) {
          ke.l.text = text;
          ke.l.kind = kind;
          ke.l.ts = ts;
          ke.l.reinforced = 1;
          ke.norm = norm;
        }
        merged = true;
        break;
      }
    }
    if (!merged) kept.push({ l: { text, kind, ts, reinforced: 1 }, norm });
  }

  // Cap to the highest-confidence lessons (confidence desc, then recency) so the doc stays bounded.
  const ranked = kept
    .map((x) => x.l)
    .sort((a, b) => brainConfidence(b) - brainConfidence(a) || b.ts - a.ts)
    .slice(0, MAX_BRAIN_LESSONS);

  return { lessons: ranked, totalBuilds: (base.totalBuilds || 0) + 1, updatedAt: nowIso };
}

/**
 * Render the top cross-project lessons as an injectable guidance block, or '' when there is not yet
 * enough history (< MIN_BUILDS_FOR_BRAIN) or nothing worth injecting. Pure — safe to inline. Uses the
 * shared lesson-block formatter (same budget as the per-workspace recall block, so they never drift).
 */
export function formatBrainLessons(brain: UserBrain | null | undefined): string {
  const b = brain && Array.isArray(brain.lessons) ? brain : null;
  if (!b || (b.totalBuilds || 0) < MIN_BUILDS_FOR_BRAIN || b.lessons.length === 0) return '';

  const ordered = [...b.lessons]
    .sort((a, b2) => brainConfidence(b2) - brainConfidence(a) || b2.ts - a.ts)
    .map((l) => l.text);
  return formatLessonBlock(HEADER, ordered);
}

/**
 * Firestore-backed persistence around the pure core. Follows the established v5.0 store pattern
 * (VITEST-skip, best-effort, never throws, `firestoreDatabaseId()` on the Firestore handle) — same
 * as FirestoreWorkspaceMemoryStore.
 */
class UserLessonBrainStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  /** Load a user's brain (null when none / unavailable). Never throws. */
  async get(userId: string | null): Promise<UserBrain | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    try {
      const snap = await db.collection('user_brain_v3').doc(userId).get();
      return snap.exists ? (snap.data() as UserBrain) : null;
    } catch {
      return null;
    }
  }

  /** Load + render the injectable cross-project lesson block in one call ('' when none). Never throws. */
  async contextFor(userId: string | null): Promise<string> {
    try {
      return formatBrainLessons(await this.get(userId));
    } catch {
      return '';
    }
  }

  /**
   * Promote one build's transferable lessons into the user's brain. Best-effort — returns the
   * updated brain when written, null otherwise. Never throws.
   */
  async recordBuildLessons(
    userId: string | null,
    episodes: readonly Episode[],
    nowIso: string,
  ): Promise<UserBrain | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    try {
      const incoming = extractPromotableLessons(episodes);
      // Skip the write when a build taught nothing, so the doc never churns on no-op builds.
      if (incoming.length === 0) return null;
      const ref = db.collection('user_brain_v3').doc(userId);
      const snap = await ref.get();
      const prev = snap.exists ? (snap.data() as UserBrain) : null;
      const next = mergeLessonsIntoBrain(prev, incoming, nowIso);
      await ref.set(next, { merge: false });
      return next;
    } catch (err) {
      console.error('[USER-BRAIN] recordBuildLessons failed:', err);
      return null;
    }
  }
}

export const userLessonBrainStore = new UserLessonBrainStore();
