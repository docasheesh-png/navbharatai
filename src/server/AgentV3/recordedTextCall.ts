/**
 * 🧬 ONE DOOR FOR A TEXT-ONLY MODEL CALL MADE OUTSIDE THE LOOP — so it cannot be made off the record.
 *
 * 🔴 THE DEFECT (Q-1125, census 2026-10-17). `AgentRunner`'s step loop records every call it makes, and
 * Q-1011 added `recordOffLoopCall` for the one call made beside it (the endgame batch repair). But the
 * ROUTE makes text-only calls of its own, and each one grew its OWN recording block — or none at all:
 *
 *   · the roadmap planner, the project planner and the fast lane's `fastGenerateOnce` each carry a
 *     hand-written `recordLlmCall` for success AND failure  — four near-identical copies;
 *   · the BLUEPRINT step carries one for success only, so its 30 s timeout and every error left the
 *     ledger empty — the exact Q-1011 asymmetry, one level down;
 *   · and the agentic lane's FOUR post-build repair gates (typecheck, missing-files, syntax,
 *     missing-export) call `makeFastTextRunner().runTurn(...)` RAW and record NOTHING, success or
 *     failure. A repair pass that spends an 8000-token answer on a broken build is exactly the call an
 *     autopsy goes looking for, and `llmCalls` had no row for it at all.
 *
 * 🔑 WHY A SHARED DOOR AND NOT A FIFTH COPY (the fourth absolute rule, step 2 — fix the CLASS). Copying
 * the recording block to the four silent gates would have fixed today's four and left the NEXT aux call
 * site free to be written without one, which is how this class was born: `fastLaneCallIdentity` and
 * `answeringModel` both exist because an aux site's private copy never received a fix made elsewhere
 * (autopsy f152c1ab: five copied sites named a VENDOR where a model belongs). The recording must live
 * where the call is MADE, so there is nothing for a new site to forget.
 *
 * ⏱️ THE BOUND LIVES HERE TOO (the 50/50 law — make the wrong branch impossible). The blueprint step
 * hand-rolled `Promise.race([call, timeout])`, and the losing call was simply abandoned with nothing
 * written down. `timeoutMs` folds that race into this door, so a bounded call ALWAYS leaves a row
 * saying it was abandoned and how long it was given. A bound whose expiry is invisible is a bound
 * nobody can size.
 *
 * ⚠️ IT INVENTS NOTHING. `answerMs` / `fallbackMs` / `openMs` / `firstOutputMs` come from the turn the
 * chain actually measured (`answerTimeOf`), and are simply absent on a failure — because on a failure
 * nothing measured them. Putting unmeasured numbers in a report is the defect this module is about.
 */
import type { RunTurnParams, TurnResult, TurnRunner } from './ClaudeClient';
import type { LlmCallRecord } from './BuildDiagnostics';
import { answerTimeOf } from './answeringModel';

/** How the caller builds its runner, names who answered, and where the row goes. */
export interface RecordedTextCallDeps {
  /**
   * Builds the text runner. `onUsed` is the chain's own report of which provider family ANSWERED —
   * the only thing that distinguishes "Claude served this" from "CLAUDE is what the variable was
   * initialised to" (see `fastLaneCallIdentity`).
   */
  readonly makeRunner: (onUsed: (used: string) => void) => TurnRunner;
  /**
   * The caller's identity resolver, already bound to its own tier model — `fastLaneCallIdentity`
   * today. `reported` is false when no rung ever reported in, and the resolver must then refuse to
   * guess rather than name the default.
   */
  readonly identify: (
    reported: boolean,
    usedProvider: string | undefined,
    answered?: string | null,
  ) => { provider: string; model: string };
  /** The one sink — `buildDiag.recordLlmCall`. */
  readonly record: (row: Omit<LlmCallRecord, 'ts'>) => void;
}

export interface RecordedTextCallOptions {
  /** The prompt as the report should show it (system + user), assembled by the caller. */
  readonly promptPreview: string;
  /** Hard bound in ms. The call is abandoned after it — and the abandonment is recorded. */
  readonly timeoutMs?: number;
  /** What the abandonment says, for the thrown error and the recorded row. */
  readonly timeoutMessage?: string;
}

/**
 * Runs one text-only turn and records it — on SUCCESS and on FAILURE — then returns it, or rethrows.
 * Recording can never break a build: every write to the sink is best-effort, exactly as each of the
 * hand-written copies it replaces was.
 */
export async function recordedTextCall(
  deps: RecordedTextCallDeps,
  params: RunTurnParams,
  opts: RecordedTextCallOptions,
): Promise<TurnResult> {
  const startedAt = Date.now();
  // Empty until a rung ANSWERS. Never pre-filled with a default: that is what `reported` guards.
  let usedProvider = '';
  let reported = false;
  const runner = deps.makeRunner((used) => { usedProvider = used; reported = true; });

  const write = (row: Omit<LlmCallRecord, 'ts'>): void => {
    try { deps.record(row); } catch { /* diagnostics capture is best-effort */ }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = runner.runTurn(params);
    const t = opts.timeoutMs == null
      ? await call
      : await Promise.race([
        call,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(opts.timeoutMessage ?? `text call timed out after ${opts.timeoutMs} ms`)),
            opts.timeoutMs,
          );
        }),
      ]);
    const servedBy = deps.identify(reported, usedProvider, t.model);
    write({
      model: servedBy.model,
      provider: servedBy.provider,
      promptPreview: opts.promptPreview,
      promptChars: opts.promptPreview.length,
      responsePreview: t.text,
      responseChars: t.text.length,
      finishReason: t.stopReason,
      toolCalls: t.toolUses.length,
      inputTokens: t.usage.inputTokens,
      outputTokens: t.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      ...answerTimeOf(t),
      ok: true,
    });
    return t;
  } catch (err) {
    const failedAs = deps.identify(reported, usedProvider);
    write({
      model: failedAs.model,
      provider: failedAs.provider,
      promptPreview: opts.promptPreview,
      promptChars: opts.promptPreview.length,
      responsePreview: '',
      responseChars: 0,
      finishReason: null,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    // A timer the race already lost would otherwise hold the process awake for its full bound.
    if (timer !== undefined) clearTimeout(timer);
  }
}
