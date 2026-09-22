// AN ATTEMPT IS ONLY SPENT ON SOMETHING NEW — what the repair loop remembers across GitHub runs.
//
// 🔴 WHY (admin 2026-09-22, "toote hi na"). The panel gives a failed phone build three attempts, and
// until now each one started from nothing: the server saw ONE failed run, one log, one diagnosis, and
// had no idea whether the very same failure had just been "repaired" five minutes earlier. So the
// rules tier could refresh the workflow, watch the identical error come back, and refresh it again;
// and a blind AI fix that changed nothing could be followed by a second blind fix that was never told
// the first one had failed. Claude Code does not work like that: when the same error comes back after
// its change, it reads THAT and corrects its change — it never repeats itself, and it never spends a
// third try on a problem it has already learned it cannot move.
//
// This module is the memory. The CLIENT carries the history (the server is stateless per request), one
// record per finished attempt, and the server asks one PURE question of it: is this failure new, or a
// repeat — and a repeat after WHAT? Each answer has a different honest consequence:
//   • new                  → the ordinary path.
//   • repeat after RULES   → the refresh has already been applied and did not help; the rules tier is
//                            skipped and the model is told what was tried.
//   • repeat after an AI   → the model's own committed change did not fix it; it is told so, in the
//     change                 build's words, and corrects its change rather than starting over.
//   • repeat after NOTHING → nothing was changed last time and the build failed the same way; nothing
//                            will change this time either. The cycle ends honestly instead of spending
//                            another five-minute run to learn the same thing. ⚠️ The shipped panel ends
//                            its cycle on every `fixed: false` answer, so from it this verdict is
//                            unreachable — it is defence in depth for a client that continues anyway
//                            (an older build, another surface), not a path the panel exercises.
//
// 🔒 The history is DATA the client sends, never an instruction: only its shape is trusted (bounded
// list, bounded strings), and nothing in it can widen what the model may read or write.

export interface AttemptRecord {
  /** The failure class of that run, as the classifier named it. */
  code: string;
  /** The compiler's / tool's own line for that failure, when the classifier extracted one. */
  error?: string | null;
  /** What was applied after that failure, if anything. */
  fixedBy?: 'rules' | 'ai' | null;
  /** For an AI fix: whether it was built here first and passed. */
  verified?: boolean;
  /** Paths the fix committed. */
  changed?: string[];
}

export type RepeatVerdict =
  | { kind: 'new' }
  | { kind: 'repeat-after-rules'; previous: AttemptRecord }
  | { kind: 'repeat-after-ai'; previous: AttemptRecord }
  | { kind: 'repeat-after-nothing'; previous: AttemptRecord };

/** Bounds on what the client may hand us — a history is a few records, never a payload. */
export const MAX_HISTORY = 6;
const MAX_ERROR_CHARS = 600;
const MAX_CHANGED = 12;

/**
 * Read the client's history into a bounded, typed list. Anything malformed is DROPPED, never guessed:
 * a record with no code is not a record, and a string field over its bound is cut, not refused.
 */
export function parseAttemptHistory(raw: unknown): AttemptRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: AttemptRecord[] = [];
  for (const item of raw.slice(-MAX_HISTORY)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const code = typeof r.code === 'string' ? r.code.trim().toUpperCase().slice(0, 64) : '';
    if (!/^[A-Z_]+$/.test(code)) continue;
    const fixedBy = r.fixedBy === 'rules' || r.fixedBy === 'ai' ? r.fixedBy : null;
    out.push({
      code,
      error: typeof r.error === 'string' && r.error.trim() ? r.error.slice(0, MAX_ERROR_CHARS) : null,
      fixedBy,
      verified: r.verified === true,
      changed: Array.isArray(r.changed)
        ? r.changed.filter((p): p is string => typeof p === 'string' && p.length <= 300).slice(0, MAX_CHANGED)
        : [],
    });
  }
  return out;
}

/**
 * Two failures are "the same" when the class matches and the tool's own line matches after the noise
 * that differs between runs (timestamps, colour codes, run-specific paths, spacing) is removed.
 * PURE. A class match with NO error line on either side is a match too — that is what a class is for.
 */
export function sameFailure(a: { code: string; error?: string | null }, b: { code: string; error?: string | null }): boolean {
  if (a.code !== b.code) return false;
  const na = normalizeError(a.error);
  const nb = normalizeError(b.error);
  if (!na && !nb) return true;
  return na === nb;
}

function normalizeError(text?: string | null): string {
  return String(text ?? '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    // ISO timestamps, and npm's log-file spelling of one (2026-09-22T10_09_41_120Z-debug-0.log)
    .replace(/\d{4}-\d{2}-\d{2}T[\d:._]+Z?(-debug-\d+\.log)?/g, '')
    .replace(/\/home\/runner\/work\/[^\s/]+\/[^\s/]+\//g, '')
    .replace(/\/home\/runner\/\.npm\/_logs\/\S*/g, '')
    // durations: "in 1.2s", "3m 12s", "412ms"
    .replace(/\b\d+(\.\d+)?\s?(ms|s|m|min)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

/** Lines that say nothing about WHICH failure this is: stack frames, the runner's exit line, npm's boilerplate. */
const NOISE_LINE = /^(at\s|##\[(group|endgroup|error)\]Process completed|##\[(group|endgroup)\]|NBAI_FAILED_STAGE=|npm (ERR!|error) (A complete log|code ELIFECYCLE|path |command |signal |errno |workspace |location )|Error: Process completed with exit code|error Command failed with exit code)/i;
/** A line that names an error, which is the line worth remembering. */
const ERROR_LINE = /\b(error|failed|fatal|cannot|could not|unable|not found|missing|unexpected|exception)\b/i;

/**
 * THE QUESTION: is this failure new, or the same one coming back — and after what?
 *
 * Only the MOST RECENT record is compared. An older, different failure that was genuinely fixed is not
 * evidence about this one, and the newest record is the one whose fix this run was the test of.
 */
export function judgeRepeat(history: readonly AttemptRecord[], current: { code: string; error?: string | null }): RepeatVerdict {
  const previous = history[history.length - 1];
  if (!previous || !sameFailure(previous, current)) return { kind: 'new' };
  if (previous.fixedBy === 'ai') return { kind: 'repeat-after-ai', previous };
  if (previous.fixedBy === 'rules') return { kind: 'repeat-after-rules', previous };
  return { kind: 'repeat-after-nothing', previous };
}

/**
 * What the model is told about earlier attempts — rendered by the prompt builder ahead of the log.
 * Vendor-free by construction: it names files and outcomes, never an engine.
 */
export function historyForModel(verdict: RepeatVerdict): string | undefined {
  if (verdict.kind === 'new') return undefined;
  const p = verdict.previous;
  const err = p.error ? ` The build said: ${p.error}` : '';
  if (verdict.kind === 'repeat-after-rules') {
    return `On the previous attempt the build files (${(p.changed ?? []).join(', ') || 'the workflow and package.json'}) were refreshed automatically and the build was run again on GitHub. It failed the SAME way.${err} That refresh is already in the files you see, so the cause is something it does not address.`;
  }
  if (verdict.kind === 'repeat-after-ai') {
    return `On the previous attempt YOUR change to ${(p.changed ?? []).join(', ') || 'the files'} was committed and the build was run again on GitHub. It failed the SAME way.${err} The files you see already contain that change — correct it; do not repeat it.`;
  }
  return `On the previous attempt nothing could be changed, and the build failed the same way.${err}`;
}

/**
 * The tool's own last words for a failed step — what `sameFailure` compares across runs. PURE.
 *
 * The last few lines of the failing step that carry content: the runner's group markers and blank
 * lines are noise, and the line that names the error is almost always at the end. Bounded, because
 * the client stores it and sends it back.
 */
export function failureSignature(stepText: string, lines = 3, maxChars = 300): string {
  const content = String(stepText || '')
    .split('\n')
    .map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '').replace(/^##\[error\]/, '').trim())
    .filter((l) => l && !NOISE_LINE.test(l));
  // The tool's own error line, when it printed one — a Vite failure is followed by a stack whose last
  // three lines are the same for every failure, so "the last lines" alone would call two different
  // errors one and the same. Fall back to the tail only when nothing names an error.
  const named = content.filter((l) => ERROR_LINE.test(l));
  const chosen = named.length > 0 ? named.slice(-lines) : content.slice(-lines);
  return chosen.join(' | ').slice(0, maxChars);
}

/** The user's sentence when the cycle ends because nothing new can be tried. Branded, vendor-free. */
export function repeatStopMessage(verdict: RepeatVerdict): string | null {
  if (verdict.kind !== 'repeat-after-nothing') return null;
  return 'The same problem came back, and there was nothing NavBharatAI could change last time — so another try would fail the same way.';
}
