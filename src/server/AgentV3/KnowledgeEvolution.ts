// AgentV3 — Knowledge Evolution (Layer 59).
//
// The project's WorkspaceMemory accumulates lessons (reflections, errors, fixes)
// across iterative builds in a session. Raw recall just returns the keyword hits —
// which can contain near-duplicates, STALE advice that a later lesson has since
// contradicted, and items in pure relevance order with no sense of freshness.
//
// This module evolves that raw set into accurate, current knowledge BEFORE it is
// fed back into the next build:
//   • de-duplication of near-identical lessons (keeping the strongest),
//   • conflict resolution — when two lessons make the SAME statement with opposite
//     polarity ("use X" vs "avoid X"), the NEWER one wins and the stale one is
//     dropped, so the team never acts on outdated advice, and
//   • recency-weighted ranking (aging) — among equally-relevant lessons the fresher
//     one ranks higher.
//
// PURE & deterministic (no I/O), and conservative by design: conflict resolution
// only fires when two lessons are essentially the same sentence with a flipped
// negation, so a genuinely useful lesson is never wrongly discarded.

export interface Lesson {
  text: string;
  /** Keyword-relevance score from recall (higher = more relevant). */
  score: number;
  /** Episode timestamp (ms); undefined for sources without a time. */
  ts?: number;
  /**
   * Outcome polarity of the lesson, used to weight CONFIDENCE:
   *   'fix'   — a change that actually WORKED → highest-confidence guidance
   *   'note'  — a reflection lesson ("use X / avoid Y")
   *   'error' — a problem that was observed (may already be resolved → lowest)
   * Absent/unknown ⇒ neutral: confidence stays 0 so legacy callers rank exactly as before.
   */
  kind?: 'fix' | 'note' | 'error' | string;
}

/** Confidence weight by outcome kind. 0 (neutral) for unknown so legacy ranking is unchanged. */
function kindWeight(kind?: string): number {
  switch (kind) {
    case 'fix': return 3;   // proven to work — trust it most
    case 'note': return 2;  // a reflection lesson
    case 'error': return 1; // a problem seen — weakest, may be stale
    default: return 0;      // unknown/absent → neutral
  }
}

/**
 * Confidence of a lesson = outcome weight + a gentle bump per REINFORCEMENT (each time the same
 * lesson was independently recorded it is more trustworthy). Gated: a lesson with no `kind` scores
 * 0 so callers that don't supply outcomes keep the exact prior relevance/recency ordering.
 */
function confidence(kind: string | undefined, reinforcements: number): number {
  const w = kindWeight(kind);
  if (w === 0) return 0;
  return w + Math.log(1 + Math.max(0, reinforcements - 1));
}

const NEGATIONS = /\b(?:dont|do not|don't|never|avoid|no longer|stop|without|not|cannot|can't|shouldn't|should not)\b/gi;
const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'is', 'are', 'in', 'on', 'for', 'with', 'use', 'using', 'when', 'this', 'that', 'it', 'your', 'you']);
const NEAR_DUP_JACCARD = 0.85;
const CONFLICT_JACCARD = 0.85;

/** Lowercase, strip `[tag]` prefixes, collapse whitespace. */
function normalize(text: string): string {
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Alphanumeric tokens of a normalized string, minus stopwords. */
function tokens(norm: string): Set<string> {
  return new Set(
    norm.split(/[^a-z0-9]+/i).filter((t) => t.length >= 1 && !STOPWORDS.has(t)),
  );
}

/** Tokens with negation words removed — the "claim" independent of polarity. */
function claimTokens(norm: string): Set<string> {
  return tokens(norm.replace(NEGATIONS, ' '));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function hasNegation(norm: string): boolean {
  NEGATIONS.lastIndex = 0;
  return NEGATIONS.test(norm);
}

/** True when two lessons are near-identical statements (so one is redundant). */
function isNearDuplicate(aNorm: string, bNorm: string): boolean {
  if (aNorm === bNorm) return true;
  // One fully contains the other (e.g. a truncated recall snippet of the same lesson).
  if (aNorm.length >= 20 && bNorm.length >= 20 && (aNorm.includes(bNorm) || bNorm.includes(aNorm))) return true;
  return jaccard(tokens(aNorm), tokens(bNorm)) >= NEAR_DUP_JACCARD;
}

/** True when two lessons make the same claim with OPPOSITE polarity (a contradiction). */
function isConflict(aNorm: string, bNorm: string): boolean {
  if (hasNegation(aNorm) === hasNegation(bNorm)) return false; // same polarity → not a conflict
  return jaccard(claimTokens(aNorm), claimTokens(bNorm)) >= CONFLICT_JACCARD;
}

/** Is `a` the one to keep over `b`? Newer wins; tie → more relevant; tie → keep `b` (incumbent). */
function preferred(a: Lesson, b: Lesson): boolean {
  const at = a.ts ?? 0;
  const bt = b.ts ?? 0;
  if (at !== bt) return at > bt;
  return a.score > b.score;
}

/**
 * Evolve a set of recalled lessons into a de-duplicated, conflict-resolved,
 * recency-ranked list of lesson texts. Input order is preserved among items of
 * equal rank (stable), so existing relevance ordering is respected. PURE.
 */
export function evolveLessons(input: Lesson[]): string[] {
  const items = input
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .map((l) => ({ lesson: l, norm: normalize(l.text) }))
    .filter((x) => x.norm);

  const kept: { lesson: Lesson; norm: string; reinforced: number }[] = [];
  for (const it of items) {
    let merged = false;
    for (let k = 0; k < kept.length; k++) {
      const ke = kept[k];
      if (isNearDuplicate(it.norm, ke.norm)) {
        // Same statement seen again → REINFORCEMENT. Keep the preferred text in its slot
        // (position) so equal-rank ordering stays stable, and bump the confirmation count.
        kept[k] = preferred(it.lesson, ke.lesson)
          ? { lesson: it.lesson, norm: it.norm, reinforced: ke.reinforced + 1 }
          : { ...ke, reinforced: ke.reinforced + 1 };
        merged = true;
        break;
      }
      if (isConflict(it.norm, ke.norm)) {
        // Contradiction (same claim, opposite polarity) → newer advice wins; this is NOT the
        // same lesson, so confirmations reset rather than accumulate.
        if (preferred(it.lesson, ke.lesson)) kept[k] = { lesson: it.lesson, norm: it.norm, reinforced: 1 };
        merged = true;
        break;
      }
    }
    if (!merged) kept.push({ lesson: it.lesson, norm: it.norm, reinforced: 1 });
  }

  // Rank by CONFIDENCE (outcome weight + reinforcement) first — so a proven, repeatedly-confirmed
  // fix outranks a one-off error — then by relevance, then recency, then original order. Confidence
  // is 0 for lessons with no `kind`, so callers that don't supply outcomes keep the prior ordering.
  return kept
    .map((x, idx) => ({ x, idx, conf: confidence(x.lesson.kind, x.reinforced) }))
    .sort((p, q) =>
      (q.conf - p.conf) ||
      (q.x.lesson.score - p.x.lesson.score) ||
      ((q.x.lesson.ts ?? 0) - (p.x.lesson.ts ?? 0)) ||
      (p.idx - q.idx),
    )
    .map((o) => o.x.lesson.text);
}
