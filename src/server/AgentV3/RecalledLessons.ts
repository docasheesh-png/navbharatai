// AgentV3 — Recalled Lessons (Layer 79 / Continual Learning).
//
// Layer 57 (Reflection) WRITES a per-build reflection — the lessons learned from
// that build's errors and fixes — back into the project's WorkspaceMemory as a
// `note` after each build. This module READS those lessons (and any past
// error/fix episodes) back at the START of the next build and formats them into
// a compact guidance block that is prepended to the build prompt. That closes
// the learning loop: the system both records lessons AND applies them, so
// iterative builds in the same session genuinely improve.
//
// PURE & deterministic: formatRecalledLessons does no I/O. The route wiring that
// calls recall() is wrapped so it can NEVER affect the build result.

import type { RecallHit } from './WorkspaceMemory';
import { evolveLessons, type Lesson } from './KnowledgeEvolution';
import { formatLessonBlock } from './LessonBlock';

/** Episode kinds whose recalled text is worth feeding back as guidance. */
const GUIDANCE_KINDS = new Set(['note', 'error', 'fix']);

const HEADER = 'Lessons from earlier in this project (apply them, avoid repeating past mistakes):';

/**
 * Build a compact guidance block from recalled memory hits. PURE & deterministic.
 *
 * Considers only hits backed by a `note` (the `[reflection]` lessons), `error`,
 * or `fix` episode — the user's own `request` episodes are excluded so we never
 * echo the current (or a past) ask back into the prompt. The relevant hits are run
 * through Knowledge Evolution (Layer 59) — de-duplicated, conflict-resolved (newer
 * advice wins over stale contradicting advice), and recency-ranked — before being
 * trimmed and formatted. Returns '' when nothing relevant remains.
 */
export function formatRecalledLessons(hits: RecallHit[]): string {
  if (!Array.isArray(hits) || hits.length === 0) return '';

  // Collect the guidance-bearing hits as Lessons (text + relevance + recency).
  const candidates: Lesson[] = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object') continue;
    // Episode hits carry their kind in `detail` and their text in `ref`.
    if (hit.type !== 'episode') continue;
    const kind = typeof hit.detail === 'string' ? hit.detail : '';
    if (!GUIDANCE_KINDS.has(kind)) continue;
    const text = typeof hit.ref === 'string' ? hit.ref.trim() : '';
    if (!text) continue;
    // Pass the episode kind so Knowledge Evolution can weight a proven `fix` above a one-off
    // `error` and rank repeatedly-confirmed lessons higher (outcome-weighted confidence).
    candidates.push({ text, score: typeof hit.score === 'number' ? hit.score : 0, ts: hit.ts, kind });
  }

  // Evolve (dedupe + resolve conflicts + outcome-weight + age/rank), then render via the shared
  // lesson-block formatter (same budget the cross-project brain uses, so they never drift).
  return formatLessonBlock(HEADER, evolveLessons(candidates));
}
