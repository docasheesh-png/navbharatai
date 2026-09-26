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

import { hasEndFileMarker } from './OneShotBuilder';

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

/**
 * Continue only while the model is still hitting the ceiling, we have attempts left, AND there is
 * something to continue FROM.
 *
 * 🔴 THE THIRD CONDITION IS NOT A REFINEMENT — IT IS THE WHOLE BUG (build report 58fe8254,
 * 2026-09-15). A reasoning model given the fast lane's output budget can spend ALL of it thinking and
 * emit no answer at all: three Kimi calls returned `outputTokens: 4833, responseChars: 0,
 * finish=max_tokens`. That is a truncated stop with an EMPTY body, so the old two-condition test said
 * "continue" — and `continuationPrompt('')` produces a prompt with no tail, i.e. **the same call
 * again**. It ran three times, ~160 s each, and the identical nothing came back each time. The build
 * spent roughly eight minutes and its entire budget re-issuing one call, then reported zero files.
 *
 * A truncation is worth resuming because a PARTIAL answer exists and would otherwise be wasted.
 * Nothing is partial about zero characters: that is a call that never began answering, and asking it
 * to "carry on from where you stopped" is the retry-loop-around-a-deterministic-failure the fourth
 * absolute rule forbids. The honest move is to stop and let the ladder's next rung try.
 */
export function shouldContinue(
  stopReason: string | null | undefined,
  attemptsSoFar: number,
  producedSoFar?: string,
): boolean {
  if (!isTruncatedStop(stopReason) || attemptsSoFar >= MAX_CONTINUATIONS) return false;
  // `undefined` keeps every existing caller's behaviour; only a caller that PASSES the text opts into
  // the guard, so this can never silently change a lane that has not been read and updated.
  if (producedSoFar !== undefined && producedSoFar.trim() === '') return false;
  return true;
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
  const cutFile = unterminatedTailPath(producedSoFar);
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
    // NAME the file that was cut off and forbid repeating its header. Without these two lines the
    // instruction below ("in the same <<<FILE …>>> format") reads as an invitation to re-open the
    // block, and a model that does so emits only the REMAINDER under a fresh header — which
    // parseFileBlocks then resolves LAST-wins, throwing the finished head of the file away. That is
    // how build bb688add shipped an Invitation.css whose first line was `-size: 0.9rem;`.
    ...(cutFile
      ? [
          `- You were cut off in the MIDDLE of ${cutFile}. Do NOT write its <<<FILE ${cutFile}>>>`,
          '  header again — your next characters must continue that file\'s content from the exact',
          '  character shown above, as if you had never stopped. Close it with <<<ENDFILE>>> when done.',
        ]
      : [
          '- If you were cut off in the MIDDLE of a file, continue that file\'s content from the exact',
          '  character shown above WITHOUT repeating its <<<FILE …>>> header, then close it with',
          '  <<<ENDFILE>>>.',
        ]),
    '- Then emit every remaining file the app still needs.',
  ].join('\n');
}

/**
 * The path AND the partial content of a trailing `<<<FILE …>>>` block that was never closed. The
 * body is what `unterminatedTailPath` throws away, and it is the half this module was losing.
 */
function unterminatedTail(text: string): { path: string; body: string } | null {
  const path = unterminatedTailPath(text);
  if (!path) return null;
  const lastHeader = text.lastIndexOf('<<<FILE');
  const m = /^<<<FILE\s+(.+?)>>>\r?\n([\s\S]*)$/.exec(text.slice(lastHeader));
  return m ? { path, body: m[2] } : { path, body: '' };
}

/** The first line with anything on it, trimmed. '' when the text is blank. */
function firstMeaningfulLine(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

/**
 * How much of a first line must agree before two bodies are judged to be the SAME file started
 * twice. Below `MIN_RESTART_PREFIX` there is too little of the partial file to preserve for the
 * question to matter, and too little text for the comparison to mean anything.
 */
const MIN_RESTART_PREFIX = 8;
const RESTART_COMPARE_CHARS = 60;

/**
 * Did the continuation START THE FILE OVER (rather than carry on from the cut)?
 *
 * The signal is the file's own first line: a restart begins where the partial began, a remainder
 * begins deep inside the file at whatever character the ceiling fell on. Both directions of
 * `startsWith` are checked because the cut can land INSIDE the first line — then the partial's first
 * line is a prefix of the restart's, not the other way round.
 *
 * Exported for testing; `null`-safe by construction (a blank partial body ⇒ "restart", because there
 * is nothing to preserve and that is exactly today's behaviour).
 */
export function continuationRestartsFile(partialBody: string, continuationBody: string): boolean {
  const a = firstMeaningfulLine(partialBody);
  const b = firstMeaningfulLine(continuationBody);
  if (a.length < MIN_RESTART_PREFIX) return true;
  if (b.startsWith(a.slice(0, RESTART_COMPARE_CHARS))) return true;
  if (b.length >= MIN_RESTART_PREFIX && a.startsWith(b.slice(0, RESTART_COMPARE_CHARS))) return true;
  return false;
}

/**
 * The file whose `<<<FILE …>>>` header the continuation REPEATED while carrying on from the cut —
 * i.e. the case where a plain join silently destroys work. Returns null in every other case.
 *
 * 🔴 THIS IS THE THIRD WAY A MODEL RESUMES, AND THE DOCBLOCK BELOW USED TO KNOW ONLY TWO (build
 * bb688add, 2026-09-20). The continuation prompt asks for "the same <<<FILE path>>> … <<<ENDFILE>>>
 * format", so a model that was cut off mid-file quite reasonably re-opens the block — and then emits
 * only the REMAINDER inside it. parseFileBlocks de-dupes LAST-wins, so that remainder REPLACES the
 * finished head of the file instead of extending it. The real, reproduced result was a
 * `src/components/Invitation.css` whose first line was `-size: 0.9rem;` — the tail of `font-size`,
 * with every rule above it gone. A `.tsx` in that state is caught by the syntax gate; a `.css`,
 * `.json` or `.html` is not, so it ships.
 */
export function resumedFilePath(previous: string, continuation: string): string | null {
  const tail = unterminatedTail(previous);
  if (!tail) return null;
  const m = /^\s*<<<FILE\s+(.+?)>>>\r?\n([\s\S]*)$/.exec(continuation);
  if (!m) return null;
  const contPath = m[1].trim().replace(/^["'`]|["'`]$/g, '');
  if (contPath !== tail.path) return null;
  return continuationRestartsFile(tail.body, m[2]) ? null : tail.path;
}

/**
 * Concatenate a continuation onto what came before.
 *
 * Plain joining is correct for the two ways a model resumes that parseFileBlocks already handles:
 *   • resumed mid-content → the partial block and its remainder fuse into one complete block;
 *   • re-emitted the whole file → the partial block is followed by the complete one, and
 *     parseFileBlocks de-dupes by path with LAST-wins, so the complete version replaces the partial.
 * The newline guard keeps a `<<<FILE …>>>` header that resumes at a line start from being welded onto
 * the tail of the previous line, where the parser could no longer see it.
 *
 * The THIRD way — re-opening the cut file's header and emitting only its remainder — is what
 * `resumedFilePath` names. There the duplicate header is dropped so the two bodies weld at the exact
 * character the ceiling fell on, which is the one join that preserves work the model already
 * produced and we already paid for.
 *
 * ⚠️ WHY "WELD" IS THE SAFE SIDE OF THE DOUBT, since both directions can be wrong. Misreading a
 * restart as a remainder duplicates the partial head at the top of the file — a broken first
 * declaration a CSS parser skips, and a parse error the syntax gate catches in a `.tsx`. Misreading
 * a remainder as a restart deletes the whole head of the file with nothing downstream able to tell:
 * that is the bug above. One degrades, the other destroys, so the doubt leans toward keeping what we
 * already have.
 */
export function joinContinuation(previous: string, continuation: string): string {
  if (!continuation) return previous;
  if (!previous) return continuation;
  const resumed = resumedFilePath(previous, continuation);
  const cont = resumed
    ? continuation.replace(/^\s*<<<FILE\s+(.+?)>>>\r?\n/, '')
    : continuation;
  const needsBreak = cont.startsWith('<<<FILE') && !previous.endsWith('\n');
  return previous + (needsBreak ? '\n' : '') + cont;
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
  // The parser's own terminator (END_FILE_MARKER): a block it closed is never a file cut off here.
  if (hasEndFileMarker(text, lastHeader)) return null;
  const m = /^<<<FILE\s+(.+?)>>>/.exec(text.slice(lastHeader));
  if (!m) return null;
  const path = m[1].trim().replace(/^["'`]|["'`]$/g, '');
  return path || null;
}
