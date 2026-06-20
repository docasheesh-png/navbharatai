/**
 * GuiderGate — decides WHEN the guider should stop and confirm a design with the
 * user (the "smart" in the Hybrid model). Pure + unit-tested.
 *
 * Rule of thumb:
 *  - Fresh build (empty workspace)      → confirm (a real design decision).
 *  - Big / multi-feature / rebuild ask  → confirm.
 *  - Small, clear edit on an existing app → DON'T confirm (keep iteration fast);
 *    the guider can still grade/refine silently in the background.
 */
export interface GateInput {
  prompt: string;
  /** Whether the workspace already has files (an existing app vs a fresh build). */
  hasExistingFiles: boolean;
  /** The caller flagged this turn as an edit of the existing app. */
  isEdit?: boolean;
}

// Phrases that signal a substantial, design-level request even on an existing app.
const BIG_SIGNALS = /\b(rebuild|re-?design|overhaul|from scratch|scratch se|complete app|full app|entire app|multiple (pages?|features?|screens?)|many features|add (a )?(dashboard|auth|login|payment|database|backend)|poora app|pura app|sab kuch)\b/i;

/** Returns true when the guider should propose a design and wait for confirmation. */
export function shouldConfirm(input: GateInput): boolean {
  const prompt = (input.prompt || '').trim();
  if (!prompt) return false;

  // Fresh build → always a design decision worth confirming.
  if (!input.hasExistingFiles) return true;

  const words = prompt.split(/\s+/).filter(Boolean).length;
  const big = BIG_SIGNALS.test(prompt);

  // Existing app: only confirm for clearly substantial requests; small edits fly through.
  if (input.isEdit) return big || words > 60;
  return big || words > 40;
}
