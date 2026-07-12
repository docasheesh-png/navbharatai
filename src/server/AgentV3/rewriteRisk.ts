// AgentV3 — full-rewrite risk assessment (edit-discipline honesty).
//
// When write_file overwrites an EXISTING file wholesale, the dangerous pattern is a
// rewrite that silently DROPS code: the model regenerated the file from memory and
// forgot part of it. The tell-tale signature is a new file that is materially SMALLER
// than the one it replaced. This module classifies that risk deterministically so the
// tool result tells the truth about a probable content loss (absolute rule: honest
// reporting) instead of a generic "consider edit_file next time".
//
// Pure and deterministic (no I/O), so the exact thresholds are unit-tested independently
// of the tool dispatcher's hot path.

export interface RewriteRisk {
  /** 'shrink' = the rewrite is suspiciously smaller (likely dropped code); 'rewrite' = a normal full write. */
  level: 'shrink' | 'rewrite';
  /** Path-agnostic guidance for the agent (the caller prepends the path + byte counts). */
  message: string;
}

/**
 * Files below this size are configs, barrels, or stubs where a full write is the normal,
 * safe way to author them — never flag a shrink for these (the ratio is noise at small sizes).
 */
const MIN_SIZE_TO_JUDGE = 400;

/** A rewrite whose new content is below this fraction of the old size is treated as likely content loss. */
const SHRINK_RATIO = 0.5;

/**
 * Classify a wholesale overwrite of an existing file.
 *
 * - `shrink`: the previous file was substantial (≥ MIN_SIZE_TO_JUDGE bytes) AND the new content is
 *   less than SHRINK_RATIO of its size — a strong signal the rewrite dropped code. The message names
 *   the exact shrink so the agent (and the user) see an honest "likely content loss" verdict.
 * - `rewrite`: any other full overwrite — the standard, non-alarming "prefer edit_file" nudge.
 */
export function assessFullRewrite(existingContent: string, newContent: string): RewriteRisk {
  const oldLen = existingContent.length;
  const newLen = newContent.length;
  if (oldLen >= MIN_SIZE_TO_JUDGE && newLen < oldLen * SHRINK_RATIO) {
    const pct = Math.round((1 - newLen / oldLen) * 100);
    return {
      level: 'shrink',
      message:
        `⚠️  LIKELY CONTENT LOSS: this full rewrite is ${pct}% SMALLER than the file it replaced ` +
        `(${oldLen} → ${newLen} bytes). A wholesale write commonly drops code the model forgot to ` +
        `regenerate. Re-read the BEFORE content below, restore anything you did not intend to delete, ` +
        `and prefer edit_file (old_string → new_string) for targeted changes.`,
    };
  }
  return {
    level: 'rewrite',
    message:
      `⚠️  FULL-REWRITE WARNING: write_file replaced the ENTIRE file. Unless you intended a full ` +
      `rewrite, use edit_file (old_string → new_string) next time — it is surgical and safe.`,
  };
}
