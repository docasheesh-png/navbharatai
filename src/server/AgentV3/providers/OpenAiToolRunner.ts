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
import { turnDeadline, BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE } from '../turnDeadline';
import { glmThinkingParam, isThinkingParamRejection, type GlmThinkingLevel } from './glmThinking';
import { reconcileFloorBudget, turnStarvedItsBudget, starvedBudgetError } from '../floorBudget';
import {
  toolDefsToOpenAI,
  transcriptToOpenAI,
  parseOpenAiCompletion,
  type OpenAiCompletionLike,
  type OpenAiMessage,
  type OpenAiTool,
} from './OpenAiToolAdapter';

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
      }): Promise<OpenAiCompletionLike>;
    };
  };
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

    // The caller's remaining budget, if it gave us one, reconciled with this runner's own bound. With
    // no deadline this is `this.opts.timeoutMs` unchanged — see turnDeadline.ts for why that matters.
    const bound = turnDeadline(this.opts.timeoutMs ?? 120_000, params.deadlineAt);
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
    const budget = reconcileFloorBudget(params.maxTokens ?? this.opts.defaultMaxTokens ?? 8000, timeoutMs);
    const request = {
        // The OpenAI-compatible provider has its own model ids, so an explicit option
        // model wins over the Anthropic model id the loop passes for Claude.
        model: this.opts.model || params.model,
        messages,
        ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
        max_tokens: budget.maxTokens,
        ...thinking,
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
    const call = async (): Promise<OpenAiCompletionLike> => {
      try {
        return await this.client.chat.completions.create(request);
      } catch (err) {
        if (!('thinking' in request) || !isThinkingParamRejection(err)) throw err;
        rememberThinkingParamRejected(thinkingModel);
        const { thinking: _dropped, ...withoutThinking } = request;
        return this.client.chat.completions.create(withoutThinking);
      }
    };
    const completion = await withTimeout(
      call(),
      timeoutMs,
      // WHOSE CLOCK RAN OUT DECIDES THE WORDING, and it is not a detail. "timed out" is matched by
      // MultiProviderTurnRunner's isTimeout, which benches a rung after two in a row — correct when the
      // PROVIDER was slow, and a lie when we handed it eight seconds because the LANE had eight seconds
      // left. A provider must never be benched for our budgeting.
      bound.source === 'deadline'
        ? BUDGET_REACHED_MESSAGE
        : `OpenAI-compatible call (GLM/Kimi) timed out after ${timeoutMs}ms`,
    );

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
    if (turnStarvedItsBudget(result)) throw starvedBudgetError(budget.maxTokens, budget.requested);

    // Stream the visible text to the caller in one shot if a callback was provided
    // (this runner is non-streaming; the loop's onText contract still gets the text).
    if (params.onText && result.text) params.onText(result.text);

    return result;
  }
}
