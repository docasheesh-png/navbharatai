// AgentV3 — OpenAI-compatible tool-use TurnRunner (multi-provider cost routing, phase 2).
//
// Implements the same TurnRunner contract as ClaudeClient, but speaks the OpenAI Chat
// Completions function-calling API — so a cheaper OpenAI-compatible provider (Grok via
// the xAI endpoint, or any OpenAI-style model) can take a turn in v5.0's build loop. The
// Anthropic⇄OpenAI translation lives in OpenAiToolAdapter (pure + tested); this runner is
// the thin I/O layer: build the request, call the client, parse the reply back to an
// Anthropic-shaped TurnResult.
//
// The client is injectable (structural) so the runner is fully unit-testable without a
// network call or key. Errors are NOT swallowed — they propagate so the multi-provider
// orchestrator can fall through to the next (ultimately Claude) provider.

import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';
import { turnDeadline, BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE, SLOW_STREAM_MESSAGE } from '../turnDeadline';
import { glmThinkingParam, isThinkingParamRejection, modelAlwaysReasons, type GlmThinkingLevel } from './glmThinking';
import { reconcileFloorBudget, turnStarvedItsBudget, starvedBudgetError } from '../floorBudget';
import {
  toolDefsToOpenAI,
  transcriptToOpenAI,
  parseOpenAiCompletion,
  type OpenAiCompletionLike,
  type OpenAiMessage,
  type OpenAiTool,
} from './OpenAiToolAdapter';
import {
  OpenAiStreamAccumulator,
  buildStreamingEnabled,
  streamHardCapMs,
  streamIdleMs,
  streamIsCrawling,
  type OpenAiStreamChunkLike,
  type StreamStopCause,
} from './openAiStream';

/** The narrow slice of an OpenAI-compatible SDK the runner needs (DI/tests). */
export interface OpenAiChatClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: OpenAiMessage[];
        tools?: OpenAiTool[];
        tool_choice?: 'auto' | 'none';
        max_tokens?: number;
        /**
         * GLM (Z.AI) reasoning-mode switch — an OpenAI-compatible EXTENSION field.
         * Only sent when the runner is configured with `thinkingControl` (the GLM
         * rung), so standard OpenAI providers (Grok, etc.) never receive it.
         */
        thinking?: { type: GlmThinkingLevel };
        /** Streamed read (see openAiStream.ts). Only ever sent when the stream flag is on. */
        stream?: true;
        /** Ask the provider to put token usage on the final chunk — a stream carries none otherwise. */
        stream_options?: { include_usage: true };
      }): Promise<OpenAiCompletionLike | OpenAiChatStream>;
    };
  };
}

/**
 * What an OpenAI-compatible SDK hands back for `stream: true` — an async iterable of chunks, with an
 * abort controller attached. Structural, so any SDK (or a test double) satisfies it.
 *
 * `controller.abort()` matters as much as the iteration does: when OUR clock stops waiting, the
 * provider is still generating and still billing. `turnDeadline.ts` records the build that logged
 * provider traffic **148 seconds after the build had ended** for exactly this reason — racing a
 * promise stops the waiting, not the call.
 */
export interface OpenAiChatStream extends AsyncIterable<OpenAiStreamChunkLike> {
  controller?: { abort(): void };
}

function isChatStream(v: unknown): v is OpenAiChatStream {
  return Boolean(v) && typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';
}

/** Reject a promise if it does not settle within `ms`. Portable (no SDK/AbortController dependency),
 *  so it bounds ANY injected client. `ms <= 0` disables the bound. Pure + module-local — the SAME
 *  helper GeminiToolRunner uses, because this family was missing the bound the other two already had. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  if (!(ms > 0)) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Read a streamed turn, bounded by SILENCE rather than by duration.
 *
 * Each `next()` races two clocks: the idle bound (no chunk for `idleMs` ⇒ the provider has stopped)
 * and the absolute ceiling (`endAt`, already reconciled with the lane's deadline). Whichever fires,
 * the stream is ABORTED — a call nobody will read must stop generating and stop billing — and what
 * has already arrived is kept.
 *
 * Returns why it stopped; the accumulator holds what was received. Never throws for a stall: a stall
 * with content is a truncated answer, and a stall with nothing is the caller's decision to make
 * (it has to be a provider failure, so the bench can see it).
 */
async function readStream(
  stream: OpenAiChatStream,
  acc: OpenAiStreamAccumulator,
  opts: {
    idleMs: number;
    endAt: number;
    onText?: (t: string) => void;
    /** The provider's own thinking, streamed as it arrives — see the reasoning note below. */
    onReasoning?: (t: string) => void;
    /**
     * May this read ABANDON a crawling provider and let the chain fall to the next rung?
     *
     * 🔒 THE CALLER OWNS THIS, AND IT IS WHAT KEEPS THE FLOOR SAFE. `readStream` cannot see the
     * ladder, so it must never decide on its own to give up on the LAST engine — a slow app beats no
     * app, and manufacturing a failure where a slow success was coming is the one way this guard
     * could make a build worse. Absent ⇒ never abandon, i.e. today's behaviour exactly.
     */
    canAbandon?: () => boolean;
    startedAt?: number;
    now?: () => number;
  },
): Promise<StreamStopCause> {
  const now = opts.now ?? (() => Date.now());
  const startedAt = typeof opts.startedAt === 'number' ? opts.startedAt : now();
  const iterator = stream[Symbol.asyncIterator]();
  const abort = () => { try { stream.controller?.abort(); } catch { /* best-effort */ } };

  try {
    for (;;) {
      const msToCeiling = opts.endAt - now();
      if (msToCeiling <= 0) { abort(); return 'deadline'; }
      const waitMs = Math.min(opts.idleMs, msToCeiling);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = Symbol('stalled');
      const tick = new Promise<typeof stalled>((resolve) => {
        timer = setTimeout(() => resolve(stalled), waitMs);
      });

      const advance = iterator.next();
      let step: IteratorResult<OpenAiStreamChunkLike> | typeof stalled;
      try {
        step = await Promise.race([advance, tick]);
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (step === stalled) {
        // 🔴 THE ABANDONED PROMISE MUST BE DISARMED. We stop waiting on `advance`, but it is still
        // live — and aborting the stream is precisely what makes it reject a moment later. With no
        // handler attached that is an unhandled rejection in the build server, from a path that
        // exists to make builds MORE reliable. Swallowed deliberately: the value can no longer be
        // read by anybody, and the stall is already being reported by the return below.
        advance.catch(() => { /* abandoned by our clock — see above */ });
        abort();
        // Which clock ran out decides the caller's wording — and a provider must never be blamed
        // for our budget (turnDeadline.ts). `waitMs` was the ceiling only when it was the smaller.
        return msToCeiling <= opts.idleMs ? 'deadline' : 'idle';
      }
      if (step.done) return 'complete';

      const before = acc.textSoFar().length;
      const reasoningBefore = acc.reasoningSoFar().length;
      acc.push(step.value);
      // REAL incremental text now, not one block at the end: the loop's onText contract finally
      // receives the answer as it is written, which is what a user watching a build sees.
      if (opts.onText) {
        const delta = acc.textSoFar().slice(before);
        if (delta) opts.onText(delta);
      }
      // 🔴 THE PROVIDER'S THINKING WAS ARRIVING AND BEING THROWN AWAY (autopsy 2b0a3ed5). The
      // accumulator has collected `reasoning_content` since streaming shipped, and the event that
      // carries it to the screen — `stream_delta` with `kind: 'thinking'` — has existed since Claude
      // got extended thinking. Nothing joined them, so on a tier that reasons the user watched an
      // empty panel while a perfectly busy model thought. The bytes are already paid for.
      if (opts.onReasoning) {
        const delta = acc.reasoningSoFar().slice(reasoningBefore);
        if (delta) opts.onReasoning(delta);
      }
      // …and the THIRD state: answering, but so slowly that waiting costs more than moving on. Judged
      // only when the caller says another rung is available — see `canAbandon`.
      if (opts.canAbandon?.() && streamIsCrawling({ producedChars: acc.producedChars(), elapsedMs: now() - startedAt })) {
        abort();
        return 'slow';
      }
    }
  } catch (err) {
    abort();
    throw err;
  }
}

export interface OpenAiToolRunnerOptions {
  /** Model id to request (e.g. 'grok-4'). Overrides params.model when set. */
  model?: string;
  /** Default max output tokens when a turn does not specify one. */
  defaultMaxTokens?: number;
  /**
   * Per-call wall-clock timeout in ms. THE FIX for build a487e019 (autopsy 2026-08-18): a hung GLM/Kimi
   * call ran **244 seconds** returning 248 tokens and burned ~6 min of a 12-min build, because THIS
   * runner — which serves GLM + Kimi, the cheap floor that LEADS every build — had NO bound at all, while
   * GeminiToolRunner and ClaudeClient both cap at 120s. Worse, with no timeout thrown, the whole
   * downstream resilience stack (the "2 consecutive timeouts → bench → re-race" logic in
   * MultiProviderTurnRunner) was BLIND to the hang — it can only react to a timeout error that never
   * came. The 2026-07-18 audit called Gemini "the only provider family missing a timeout"; it was wrong —
   * the most-used family was missing it too. This rejects on overrun so the orchestrator falls through to
   * the next provider (a timeout is transient), and the message says "timed out" so `isTimeout` benches a
   * repeatedly-stalling provider. Default 120000 (parity with Gemini/Claude); set 0 to disable.
   */
  timeoutMs?: number;
  /**
   * When true, this runner speaks the GLM (Z.AI) `thinking` dialect: the turn's
   * `thinking` boolean (the SAME user-facing toggle that drives Claude's adaptive
   * thinking) is translated to GLM's `thinking: { type: 'enabled' | 'disabled' }`
   * request field. One toggle, every module. Left off for Grok/other OpenAI-style
   * providers that would reject the extension field.
   */
  thinkingControl?: boolean;
}

/**
 * Models observed to REJECT the `thinking` field, remembered for the life of this process.
 *
 * Process-scoped rather than per-runner because a runner is constructed per rung per build, so a
 * per-instance memo would re-pay the wasted round-trip on every single build. It can only ever cause
 * an OPTIONAL field to be omitted, so a stale entry costs nothing but the model's default effort —
 * exactly the behaviour that shipped before this field was sent at all.
 */
const thinkingParamRejectedBy = new Set<string>();

function rememberThinkingParamRejected(model: string | undefined): void {
  if (model) thinkingParamRejectedBy.add(model.toLowerCase().trim());
}

export function modelRejectsThinkingParam(model: string | undefined): boolean {
  return Boolean(model) && thinkingParamRejectedBy.has(String(model).toLowerCase().trim());
}

/** Test-only: forget what was learned, so one case cannot leak into the next. */
export function _resetThinkingParamMemo(): void {
  thinkingParamRejectedBy.clear();
}

/**
 * Models OBSERVED to spend a clamped output budget entirely on reasoning, remembered for the process.
 *
 * 🔴 THE QUESTION THIS ANSWERS WITHOUT GUESSING (autopsy f5351721 + report 58fe8254). `modelAlwaysReasons`
 * knows about GLM 5.3+ because this repo has a numeric family rule for GLM. **It knows nothing about
 * Moonshot's models** — and report 58fe8254 shows the identical `outputTokens: 4833` starvation three
 * times on Kimi. The tempting fix was to assert that Kimi always reasons; that would be a claim about a
 * vendor nobody here has measured, which is exactly the kind of invention the rules forbid.
 *
 * 🔑 SO THE ENGINE LEARNS IT INSTEAD OF BEING TOLD. The FIRST time any model burns a clamped budget
 * without producing text or a tool call, that is a measurement — the strongest evidence there is that
 * its thinking does not fit our ceiling. Every later call to that model skips the clamp, exactly as if
 * the capability had been known in advance. Vendor-agnostic, so a model nobody has heard of yet is
 * covered on the day it ships.
 *
 * ⚠️ IT ONLY EVER RECORDS A *CLAMPED* STARVATION. A rung that starved with the clamp already lifted has
 * proved the opposite — more budget did not help — so remembering it would buy nothing and would make
 * the memo mean two different things.
 *
 * 🔒 Process-scoped, like the thinking-param memo above and for the same reason: a runner is built per
 * rung per build, so a per-instance memo would re-pay the same wasted call on every build. A stale
 * entry is harmless by construction — it can only RAISE a ceiling, and the clock still bounds the call
 * (proven in the unclamp change: the worst case is identical to today, never worse).
 */
const starvedWhileClampedBy = new Set<string>();

function rememberStarvedWhileClamped(model: string | undefined): void {
  if (model) starvedWhileClampedBy.add(model.toLowerCase().trim());
}

export function modelStarvedWhileClamped(model: string | undefined): boolean {
  return Boolean(model) && starvedWhileClampedBy.has(String(model).toLowerCase().trim());
}

/** Test-only: forget what was learned, so one case cannot leak into the next. */
export function _resetStarvedBudgetMemo(): void {
  starvedWhileClampedBy.clear();
}

/**
 * A TurnRunner backed by an OpenAI-compatible chat-completions client with native
 * function calling. Usable for Grok (xAI) and any OpenAI-style endpoint.
 */
export class OpenAiToolRunner implements TurnRunner {
  constructor(
    private readonly client: OpenAiChatClient,
    private readonly opts: OpenAiToolRunnerOptions = {},
  ) {}

  async runTurn(params: RunTurnParams): Promise<TurnResult> {
    const tools = toolDefsToOpenAI(params.tools);
    const messages = transcriptToOpenAI(params.messages, params.system);

    // GLM rung only: forward the user's thinking toggle to GLM's reasoning switch, so
    // the one app-level thinking setting controls this module too — not just Claude.
    //
    // 🔴 THE MODEL DECIDES WHETHER "OFF" IS EVEN SAYABLE (build report 58fe8254, 2026-09-15). This line
    // used to send `{ type: 'disabled' }` to whatever model the rung named, and `glm-5.3-flash` — the
    // FIRST rung of the Weak and Normal ladders since 2026-09-14 — rejects that with a hard 400
    // ("This model always engages in thinking and cannot be disabled"). One build logged **280** of
    // them.
    //
    // 🔴 AND OMITTING THE FIELD WAS NOT THE ANSWER EITHER (autopsy ee20478d, one day later). That 400's
    // full text is *"…cannot be disabled; please use low, high, or max"* — the first clause was acted
    // on and the second was not. Sending NO field does not mean "think less", it means "use your
    // DEFAULT effort", and on glm-5.3-flash that default ate the entire output ceiling on three
    // consecutive turns: 4,833 tokens, no text, no tool call, zero files in five minutes.
    // `glmThinkingParam` now sends the provider's own lowest level instead; see glmThinking.ts.
    const thinkingModel = this.opts.model || params.model;
    const thinking = this.opts.thinkingControl && !modelRejectsThinkingParam(thinkingModel)
      ? glmThinkingParam(thinkingModel, params.thinking)
      : {};

    // 🔴 HOW WE READ DECIDES WHICH CLOCK BOUNDS THE CALL (admin 2026-09-16: "kimi aur glm slow hai,
    // time out ho jata hai"). Non-streaming keeps the TOTAL bound it has always had, because with one
    // opaque request that is the only hang signal available. Streaming replaces it with the hard
    // ceiling and measures SILENCE instead — see openAiStream.ts for why a proxy became a direct
    // measurement. The lane's deadline still wins whenever it is nearer; `turnDeadline` stays the
    // authority on the budget either way, and with the flag off this line is the old one exactly.
    const streaming = buildStreamingEnabled();
    const configuredMs = streaming ? streamHardCapMs() : (this.opts.timeoutMs ?? 120_000);
    const bound = turnDeadline(configuredMs, params.deadlineAt);
    // 🔴 REFUSE BEFORE SPENDING. The lane that asked has already run out of clock, so this call's answer
    // can no longer be read by anybody. Starting it would buy nothing and bill for it — which is exactly
    // the 148 seconds of post-mortem provider traffic in the report that produced this contract.
    if (bound.expired) throw new Error(BUDGET_EXHAUSTED_MESSAGE);
    const timeoutMs = bound.timeoutMs;
    // 🔴 NEVER AUTHORISE MORE OUTPUT THAN THE CLOCK CAN CARRY (autopsy 4efab9d7 — see floorBudget.ts).
    //
    // The build loop asks for 32,000 tokens a turn; this rung had 60 seconds, which at the rate that
    // build itself measured is about 1,830. So the ONE turn that writes files — the only turn that
    // ever uses the budget — could not fit, on any key, and the report said the app was not built.
    //
    // Clamping converts the failure mode: a turn that runs long now ends TRUNCATED, which returns the
    // files it already wrote and names the one that was cut, instead of TIMED OUT, which returns
    // nothing at all. `bound.timeoutMs` (not the configured one) is used deliberately — a lane with
    // thirty seconds left must not authorise a 32,000-token answer either.
    //
    // 🔴 EXCEPT WHERE THE CLAMP IS INVERTED — a rung that reasons whether we ask it to or not bills that
    // thinking to this same ceiling and emits it BEFORE any content, so for it the CEILING is the total
    // loss and the CLOCK is the recoverable one. Autopsy f5351721: three calls on `glm-5.3` returned
    // reasoning and nothing else at exactly 9,833 tokens, the first of them 131 seconds into a
    // 300-second clock — out of ceiling with 58% of its time unused. See floorBudget.ts for why a
    // faster rate constant was measured and rejected, and why unclamping cannot make the worst case
    // worse. The capability question is asked of the module that owns it; `modelAlwaysReasons` is a
    // POSITIVE test, so a vendor we have not measured keeps today's clamp exactly.
    const budget = reconcileFloorBudget(
      params.maxTokens ?? this.opts.defaultMaxTokens ?? 8000,
      timeoutMs,
      process.env,
      // Known in advance (GLM 5.3+), or LEARNED from this model's own first clamped starvation.
      { alwaysReasons: modelAlwaysReasons(thinkingModel) || modelStarvedWhileClamped(thinkingModel) },
    );
    const request = {
        // The OpenAI-compatible provider has its own model ids, so an explicit option
        // model wins over the Anthropic model id the loop passes for Claude.
        model: this.opts.model || params.model,
        messages,
        ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
        max_tokens: budget.maxTokens,
        ...thinking,
        // `include_usage` is what puts token counts on the final chunk. Without it a stream carries
        // NONE, and the ONE-WALLET LAW forbids inventing them — so an unmeasured turn would be billed
        // at zero and our own cost report would under-state itself. Asking is all the code can do;
        // whether a given provider honours it is a fact only a real call can settle.
        ...(streaming ? { stream: true as const, stream_options: { include_usage: true as const } } : {}),
    };
    // 🔒 THE BET CHECKS ITSELF ON FIRST CONTACT, so it can never become another 280-failure build.
    //
    // The three level names (`low` / `high` / `max`) come from the provider's own error text, not from
    // a document this session could read — so the field's exact shape is a reasoned bet, not a verified
    // fact. If a model rejects it, we drop the field and retry the SAME call once; the model is then
    // remembered for the life of the process, so the extra round-trip is paid at most once per model
    // rather than once per call. Worst case is byte-identical to the behaviour before this change.
    //
    // ⚠️ The retry is narrow ON PURPOSE. `isThinkingParamRejection` must match a complaint about this
    // one optional field and nothing else: re-sending a genuinely bad request unchanged would be a
    // retry loop around a deterministic failure, which the fourth absolute rule forbids by name. And
    // the retry happens only when we actually SENT the field — never on a call that had no opinion.
    const call = async (): Promise<OpenAiCompletionLike | OpenAiChatStream> => {
      try {
        return await this.client.chat.completions.create(request);
      } catch (err) {
        if (!('thinking' in request) || !isThinkingParamRejection(err)) throw err;
        rememberThinkingParamRejected(thinkingModel);
        const { thinking: _dropped, ...withoutThinking } = request;
        return this.client.chat.completions.create(withoutThinking);
      }
    };

    // WHOSE CLOCK RAN OUT DECIDES THE WORDING, and it is not a detail. "timed out" is matched by
    // MultiProviderTurnRunner's isTimeout, which benches a rung after two in a row — correct when the
    // PROVIDER was slow, and a lie when we handed it eight seconds because the LANE had eight seconds
    // left. A provider must never be benched for our budgeting.
    const clockMessage = (ms: number) => (bound.source === 'deadline'
      ? BUDGET_REACHED_MESSAGE
      : `OpenAI-compatible call (GLM/Kimi) timed out after ${ms}ms`);

    const idleMs = Math.min(streamIdleMs(), timeoutMs);
    const startedAt = Date.now();
    // The response OBJECT must still arrive promptly even when streaming: a provider that has not
    // answered the request at all inside the idle window is hung before it has begun.
    //
    // 🔴 SILENCE IS THE PROVIDER'S, NOT OUR BUDGET'S (autopsy fdd59ef8, 2026-09-17). `clockMessage`
    // decides by `bound.source`, which describes the TOTAL clock — so when the IDLE bound fired first
    // it still reported *"build budget reached while this call was still running"*. That report shows
    // the contradiction in two places at once: the call died at 60,012 ms while `CORRECTION_BUDGET`
    // recorded **1,665 s of budget still left**.
    //
    // 🔑 AND THE MISLABEL DISABLED THE REPAIR. `BUDGET_REACHED_MESSAGE` deliberately never benches a
    // provider ("a provider must never be benched for our budgeting") — correct when it is true. Here
    // it was false, so a rung that had gone silent for a full minute was recorded as our own clock
    // ending, was NOT benched, and the ladder never advanced. That is also what makes the ~104-rung
    // GLM key pool in the same report look alarming: the family bench is exactly the mechanism that
    // makes a long pool harmless, and this wording was switching it off.
    //
    // The test is arithmetic, not a guess: `idleMs = min(streamIdleMs(), timeoutMs)`, so when
    // `idleMs < timeoutMs` the lane still had more clock than the silence window — whatever fired at
    // `idleMs` was the provider saying nothing, and our budget was not involved.
    const initialBoundMs = streaming ? idleMs : timeoutMs;
    const providerWentSilent = streaming && idleMs < timeoutMs;
    const raw = await withTimeout(
      call(),
      initialBoundMs,
      providerWentSilent
        ? `OpenAI-compatible call (GLM/Kimi) timed out after ${idleMs}ms`
        : clockMessage(initialBoundMs),
    );

    let completion: OpenAiCompletionLike;
    let streamedText = false;
    if (streaming && isChatStream(raw)) {
      streamedText = true;
      const acc = new OpenAiStreamAccumulator();
      const stop = await readStream(raw, acc, {
        idleMs,
        endAt: startedAt + timeoutMs,
        startedAt,
        onText: params.onText,
        // The provider's own thinking, straight to the screen — see the reasoning note in the loop.
        onReasoning: params.onThinking,
        // Only the ladder knows whether there is somewhere else to go; absent ⇒ never abandon.
        canAbandon: params.canAbandonSlowStream,
      });

      // 🔑 THE POINT OF THE WHOLE CHANGE. A stall used to destroy the call; now it keeps the answer
      // that had already arrived and reports it as TRUNCATED — the one vocabulary the engine already
      // handles well (the adapter salvages the cut file's path, the truncation guard names it, the
      // next turn rewrites it). "One file short" instead of "no app".
      //
      // With NOTHING salvageable it must still be a provider failure, not a quiet empty answer:
      // thrown so the chain falls to the next vendor AND `isTimeout` can bench a rung that keeps
      // stalling. Reasoning alone is not salvageable — see `hasAnswer`.
      // 🔴 A CRAWLING PROVIDER IS ABANDONED WHOLE, answer or not (autopsy 2b0a3ed5). By definition
      // it produced almost nothing — that is what put it under the floor — so there is no partial
      // answer worth the turn it would cost to keep. Thrown with the marker below so the ladder can
      // tell this apart from a hung provider and bench the FAMILY immediately, rather than sending
      // the next turn back to the same crawling rung.
      if (stop === 'slow') {
        throw new Error(`${SLOW_STREAM_MESSAGE} after ${Math.max(0, Date.now() - startedAt)}ms`);
      }
      if (stop !== 'complete' && !acc.hasAnswer()) {
        throw new Error(stop === 'deadline' ? BUDGET_REACHED_MESSAGE : clockMessage(idleMs));
      }
      completion = acc.toCompletion(stop);
    } else {
      completion = raw as OpenAiCompletionLike;
    }

    const result = parseOpenAiCompletion(completion);

    // 🔴 A TURN THAT COULD NOT BEGIN AN ANSWER IS A FAILURE OF THIS RUNG, NOT AN ANSWER FROM IT
    // (autopsy ee20478d, 2026-09-15 — see floorBudget.ts for the arithmetic).
    //
    // The clamp above authorises at most 4,833 output tokens, and a reasoning model's thinking is
    // billed to that same ceiling and emitted BEFORE any content. So this rung can return HTTP 200,
    // `finish_reason: 'length'`, no text and no tool call — 4,833 tokens of thinking and nothing to
    // salvage. Returning it as a result made three things go wrong at once: the loop appended an
    // EMPTY assistant turn and nudged the model to "stop describing and act" (it had described
    // nothing), the identical doomed call was repeated twice more at ~97 s each, and the failure
    // never entered the provider-failure ledger — so every honesty check that reads that ledger was
    // blind and the user was asked to pay for a stronger engine.
    //
    // Throwing puts it where it belongs: the chain falls to the NEXT rung, which is a different
    // vendor and usually not a forced-thinking one, and the build proceeds instead of ending empty.
    if (turnStarvedItsBudget(result)) {
      // Learn it, so this model is never clamped again in this process. Only a CLAMPED starvation is
      // evidence — see `modelStarvedWhileClamped`.
      if (!budget.reasoningUnclamped) rememberStarvedWhileClamped(thinkingModel);
      // WHICH CLOCK CUT THE CEILING IS PART OF THE FINDING (autopsy d98dae01). `bound.source` is the
      // only place that fact exists, and without it the report blames this engine's own cap for a
      // ceiling the CALLING LANE's remaining budget decided — sending the next autopsy to fix
      // arithmetic that was already right. See STARVED_BY_LANE_MARK in floorBudget.ts.
      throw starvedBudgetError(
        budget.maxTokens,
        budget.requested,
        budget.reasoningUnclamped,
        bound.source === 'deadline' ? timeoutMs : undefined,
      );
    }

    // Hand the visible text to the caller in one shot — unless the streamed path already delivered it
    // delta by delta, in which case repeating it here would print the answer twice.
    if (!streamedText && params.onText && result.text) params.onText(result.text);

    return result;
  }
}
