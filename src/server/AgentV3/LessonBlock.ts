// AgentV3 — shared lesson-block renderer.
//
// Both the per-workspace recall (RecalledLessons) and the cross-project brain (UserLessonBrain)
// inject a short, capped bullet list of lessons into the build prompt. They share the exact same
// budget (≤6 lessons, ≤160 chars each, ≤1200 chars total) and assembly loop — this is the single
// definition so the two injection points can never drift apart. PURE & deterministic.

/** Default injection budget — kept in ONE place so recall + brain stay identical. */
export const LESSON_BLOCK_DEFAULTS = {
  maxLessons: 6,
  lessonMaxChars: 160,
  blockMaxChars: 1200,
} as const;

/** Trim a lesson to a short single-line snippet (~max chars). */
export function lessonSnippet(text: string, max: number = LESSON_BLOCK_DEFAULTS.lessonMaxChars): string {
  const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * Render an ordered list of lesson texts into a capped, headed bullet block, or '' when there is
 * nothing to show. The caller supplies lessons ALREADY ordered (most important first); this trims,
 * caps and assembles. Returns '' if no lesson fits (header-only is never emitted). PURE.
 */
export function formatLessonBlock(
  header: string,
  lessons: readonly string[],
  opts: { maxLessons?: number; lessonMaxChars?: number; blockMaxChars?: number } = {},
): string {
  const maxLessons = opts.maxLessons ?? LESSON_BLOCK_DEFAULTS.maxLessons;
  const lessonMaxChars = opts.lessonMaxChars ?? LESSON_BLOCK_DEFAULTS.lessonMaxChars;
  const blockMaxChars = opts.blockMaxChars ?? LESSON_BLOCK_DEFAULTS.blockMaxChars;

  const trimmed = (Array.isArray(lessons) ? lessons : [])
    .filter((t) => typeof t === 'string' && t.trim())
    .slice(0, maxLessons)
    .map((t) => lessonSnippet(t, lessonMaxChars));

  const lines = [header];
  for (const lesson of trimmed) {
    const candidate = `- ${lesson}`;
    if (lines.join('\n').length + 1 + candidate.length > blockMaxChars) break;
    lines.push(candidate);
  }
  // Header only (nothing fit) → nothing useful to inject.
  if (lines.length === 1) return '';
  return lines.join('\n');
}
