// AgentV3 — runtime-error auto-fix loop (R4 §2.3).
//
// A build can compile and even render, yet still throw runtime errors a static check never
// reveals (an undefined call, a failed fetch, a React render crash). The browser daemon already
// CAPTURES these (getConsoleErrors); this module turns detection into a closed loop: after a
// build, surface the captured runtime errors back to a repair pass that fixes them, re-runs, and
// re-verifies — and reports an honest WARNING if any remain. Pure, deterministic helpers here;
// the impure orchestration (capture → repair runner → re-capture) lives in the build route.

import { locationTag } from '../AppMakerLab/intelligence/LogIntelligenceEngine';

export interface RuntimeError {
  t: number;
  kind: string;
  text: string;
}

/**
 * The loop is OFF by default and enabled with AGENTV3_AUTOFIX=on. It runs an extra (paid) repair
 * pass, so — like escalation — it stays opt-in until the admin turns it on, never a surprise cost.
 */
export function autoFixEnabled(): boolean {
  return process.env.AGENTV3_AUTOFIX === 'on';
}

/** Max repair attempts per build. Default 1, hard-capped at 3 so a flaky error can't loop forever. */
export function autoFixMaxAttempts(): number {
  const raw = Number(process.env.AGENTV3_AUTOFIX_ATTEMPTS);
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return Math.min(raw, 3);
}

// Noise that is not a real app defect — these should never trigger a repair pass.
const NOISE = [
  /favicon\.ico/i,
  /\.map(\b|$)/i, // sourcemap fetch failures
  /ResizeObserver loop/i, // benign browser warning
  /\[vite\] connecting/i,
  /\[vite\] connected/i,
  /Download the React DevTools/i,
];

/**
 * Keep only actionable runtime errors — drop known-benign noise and de-duplicate by text, so the
 * repair pass focuses on real defects. Non-array input yields an empty list (never throws).
 */
export function filterActionableErrors(errors: unknown): RuntimeError[] {
  if (!Array.isArray(errors)) return [];
  const seen = new Set<string>();
  const out: RuntimeError[] = [];
  for (const e of errors) {
    if (!e || typeof e !== 'object') continue;
    const text = typeof (e as RuntimeError).text === 'string' ? (e as RuntimeError).text.trim() : '';
    if (!text) continue;
    if (NOISE.some((re) => re.test(text))) continue;
    const key = text.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      t: typeof (e as RuntimeError).t === 'number' ? (e as RuntimeError).t : 0,
      kind: typeof (e as RuntimeError).kind === 'string' ? (e as RuntimeError).kind : 'error',
      text,
    });
  }
  return out;
}

/** Format the captured errors as a compact, readable list (capped) for a prompt or a message. */
export function formatRuntimeErrors(errors: RuntimeError[], max = 20): string {
  // P-AI.11 — append a parsed file:line:col + type hint (when extractable from the error text) so
  // the repair pass can jump straight to the failing location instead of re-deriving it.
  return errors.slice(0, max).map((e) => `- [${e.kind}] ${e.text}${locationTag(e.text)}`).join('\n');
}

/**
 * The repair instruction handed to a Claude-first runner on the SAME workspace. It tells the agent
 * exactly what is broken at runtime and to fix → reload → re-verify, without rebuilding from scratch.
 */
export function buildRepairPrompt(errors: RuntimeError[]): string {
  return [
    'The app you just built has RUNTIME errors captured in the browser while it was running',
    '(these do not show up in a successful build/compile). Fix them now without rebuilding from',
    'scratch — make the smallest targeted edits that resolve each one:',
    '',
    formatRuntimeErrors(errors),
    '',
    'Steps: locate the cause with grep/read_file, apply a surgical edit_file fix, then RELOAD the',
    'preview and call console_errors again to confirm the errors are gone. Do not claim success',
    'until the runtime errors are actually cleared. If an error is benign or external (e.g. a',
    'third-party request you do not control), say so explicitly rather than forcing a change.',
  ].join('\n');
}

/** Honest warning shown when some runtime errors remain after the repair budget is spent. */
export function autoFixWarning(errors: RuntimeError[]): string {
  return [
    `⚠️ ${errors.length} runtime error(s) may still remain after auto-fix:`,
    formatRuntimeErrors(errors, 10),
    'The app was built, but please review these — they were detected in the browser at runtime.',
  ].join('\n');
}
