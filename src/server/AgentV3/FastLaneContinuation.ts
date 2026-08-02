// AgentV3 — FAST-LANE TRUNCATION CONTINUATION (admin report 2026-08-02, buildId 858f6d7b).
//
// ROOT CAUSE it closes. The fast lane (Simple Builder + OneShot) asks a model to emit whole files as
// `<<<FILE path>>>…<<<ENDFILE>>>` TEXT blocks, with `tools: []`. Those calls do NOT go through
// AgentRunner, so the existing TruncationRecovery guard — which only runs inside the agentic loop —
// could never see them. The fast lane had NO truncation handling at all.
//
// What that cost on a plain to-do app: kimi hit its output ceiling TWICE (`finish=max_tokens`, 8000
// output tokens each). The one-shot response was cut off before it ever emitted `src/main.tsx`, and
// the lane accepted the truncated text as a finished app. Downstream, the foundational-file healer
// noticed main.tsx was missing and synthesized a generic one — whose `react-dom/client` import is the
// exact line the user's preview then failed on. A silent truncation upstream surfaced as a broken
// preview two subsystems later, and ~16k of the 33k billed output tokens were spent on discarded text.
//
// THE 50/50 LAW. Healing the missing file afterwards is the symptom half. This module is the other
// half: the response is never allowed to STAY truncated. When a call stops at the output ceiling we
// ask the model to continue from exactly where it stopped and concatenate the result — so the fast
// lane produces a COMPLETE app on the first pass and the healer becomes dead code. It is deliberately
// provider-cap-agnostic: raising `max_tokens` only moves the ceiling (and risks a 400 on a provider
// whose real cap is lower), while continuing works no matter where the ceiling sits.
//
// PURE + unit-tested. The impure LLM round trip lives at the call site in routes/agentv3.ts.

/** Provider stop reasons that mean "I ran out of output budget", not "I finished". */
export function isTruncatedStop(stopReason: string | null | undefined): boolean {
  return stopReason === 'max_tokens' || stopReason === 'length';
}

/**
 * How many continuation round trips a single fast-lane generation may spend. Bounded so a model that
 * never terminates cannot burn a build's wall clock or the user's wallet; 3 continuations quadruples
 * the effective output ceiling, which covers every real app this lane builds.
 */
export const MAX_CONTINUATIONS = 3;

/** Continue only while the model is still hitting the ceiling AND we have attempts left. */
export function shouldContinue(stopReason: string | null | undefined, attemptsSoFar: number): boolean {
  return isTruncatedStop(stopReason) && attemptsSoFar < MAX_CONTINUATIONS;
}

/** How much of the produced text to echo back so the model can resume at the exact cut point. */
const TAIL_CHARS = 1200;

/**
 * The user-turn that resumes a cut-off generation. Sent as a USER message rather than an assistant
 * prefill so it behaves identically across every provider in the ladder (Anthropic, the
 * OpenAI-compatible cheap coders, Gemini) — no adapter needs assistant-continuation support.
 */
export function continuationPrompt(producedSoFar: string): string {
  const tail = producedSoFar.slice(-TAIL_CHARS);
  return [
    'Your previous response was cut off because it hit the output-token limit. Here are the LAST',
    `${tail.length} characters you produced, so you can see exactly where you stopped:`,
    '',
    '--- END OF YOUR PREVIOUS OUTPUT ---',
    tail,
    '--- RESUME HERE ---',
    '',
    'Continue from EXACTLY that point, in the same <<<FILE path>>> … <<<ENDFILE>>> format.',
    'RULES:',
    '- Do NOT repeat any file you already finished, and do NOT start over.',
    '- Do NOT add prose, apologies, or explanation — output file blocks only.',
    '- If you were cut off in the MIDDLE of a file, continue that file\'s content from the exact',
    '  character shown above and then close it with <<<ENDFILE>>>.',
    '- Then emit every remaining file the app still needs.',
  ].join('\n');
}

/**
 * Concatenate a continuation onto what came before.
 *
 * Plain joining is correct for BOTH ways a model resumes, thanks to parseFileBlocks:
 *   • resumed mid-content → the partial block and its remainder fuse into one complete block;
 *   • re-emitted the whole file → the partial block is followed by the complete one, and
 *     parseFileBlocks de-dupes by path with LAST-wins, so the complete version replaces the partial.
 * The newline guard keeps a `<<<FILE …>>>` header that resumes at a line start from being welded onto
 * the tail of the previous line, where the parser could no longer see it.
 */
export function joinContinuation(previous: string, continuation: string): string {
  if (!continuation) return previous;
  if (!previous) return continuation;
  const needsBreak = continuation.startsWith('<<<FILE') && !previous.endsWith('\n');
  return previous + (needsBreak ? '\n' : '') + continuation;
}

/**
 * The path of a trailing `<<<FILE …>>>` block that was never closed with `<<<ENDFILE>>>` — i.e. the
 * file the model was still writing when it was cut off. Returns null when the text ends cleanly.
 *
 * This exists because parseFileBlocks deliberately terminates a final block at end-of-input (so a
 * missing ENDFILE cannot swallow the NEXT file). That recovery is right for a merely sloppy response,
 * but it also means a genuinely TRUNCATED file is handed back looking exactly like a complete one —
 * half a component, silently written to the workspace and shipped as built. When continuations are
 * exhausted the caller uses this to drop the half-written file and say so, instead of shipping it.
 */
export function unterminatedTailPath(text: string): string | null {
  if (!text) return null;
  const lastHeader = text.lastIndexOf('<<<FILE');
  if (lastHeader === -1) return null;
  if (text.indexOf('<<<ENDFILE>>>', lastHeader) !== -1) return null;
  const m = /^<<<FILE\s+(.+?)>>>/.exec(text.slice(lastHeader));
  if (!m) return null;
  const path = m[1].trim().replace(/^["'`]|["'`]$/g, '');
  return path || null;
}
