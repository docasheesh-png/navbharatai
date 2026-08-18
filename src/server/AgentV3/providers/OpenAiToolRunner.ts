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
        thinking?: { type: 'enabled' | 'disabled' };
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
    const thinking = this.opts.thinkingControl && typeof params.thinking === 'boolean'
      ? { thinking: { type: params.thinking ? 'enabled' as const : 'disabled' as const } }
      : {};

    const timeoutMs = this.opts.timeoutMs ?? 120_000;
    const completion = await withTimeout(
      this.client.chat.completions.create({
        // The OpenAI-compatible provider has its own model ids, so an explicit option
        // model wins over the Anthropic model id the loop passes for Claude.
        model: this.opts.model || params.model,
        messages,
        ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
        max_tokens: params.maxTokens ?? this.opts.defaultMaxTokens ?? 8000,
        ...thinking,
      }),
      timeoutMs,
      // "timed out" is deliberate: MultiProviderTurnRunner's isTimeout matches it, so a repeatedly
      // stalling GLM/Kimi rung gets benched + re-raced instead of hanging the build again.
      `OpenAI-compatible call (GLM/Kimi) timed out after ${timeoutMs}ms`,
    );

    const result = parseOpenAiCompletion(completion);

    // Stream the visible text to the caller in one shot if a callback was provided
    // (this runner is non-streaming; the loop's onText contract still gets the text).
    if (params.onText && result.text) params.onText(result.text);

    return result;
  }
}
