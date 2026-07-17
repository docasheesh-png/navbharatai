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

export interface OpenAiToolRunnerOptions {
  /** Model id to request (e.g. 'grok-4'). Overrides params.model when set. */
  model?: string;
  /** Default max output tokens when a turn does not specify one. */
  defaultMaxTokens?: number;
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

    const completion = await this.client.chat.completions.create({
      // The OpenAI-compatible provider has its own model ids, so an explicit option
      // model wins over the Anthropic model id the loop passes for Claude.
      model: this.opts.model || params.model,
      messages,
      ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
      max_tokens: params.maxTokens ?? this.opts.defaultMaxTokens ?? 8000,
      ...thinking,
    });

    const result = parseOpenAiCompletion(completion);

    // Stream the visible text to the caller in one shot if a callback was provided
    // (this runner is non-streaming; the loop's onText contract still gets the text).
    if (params.onText && result.text) params.onText(result.text);

    return result;
  }
}
