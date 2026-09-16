// AgentV3 — STREAMED reading of an OpenAI-compatible turn, and the clock that judges it.
//
// 🔴 THE PROBLEM THIS EXISTS FOR (admin 2026-09-16: "kimi aur glm slow hai, time out ho jata hai").
//
// The GLM/Kimi rung sends ONE non-streaming request and bounds it with a TOTAL wall-clock timeout
// (`floorBudget.ts`: 5 s + 30 ms × tokens, capped at 150 s). That bound exists to catch a HUNG
// provider — but a total clock cannot tell a hung provider from a slow one, and it punishes them
// identically. Two costs follow, and the second is the expensive one:
//
//   1. A provider that is merely SLOW is killed mid-answer even though it was working.
//   2. When it is killed, **nothing comes back**. The whole call is lost — the files it had already
//      written in that answer included. 150 seconds, zero files.
//
// The output ceiling is sized from that same clock, so the two compound: at 30 ms/token a 150 s call
// authorises ~4,800 tokens, which is why a big file takes several turns, which is more calls to be
// slow on.
//
// 🔑 THE INSIGHT: a total clock is a PROXY for "is this provider hung?", and streaming lets us
// measure that directly. A provider emitting tokens is not hung, however slow it is; a provider that
// has emitted nothing for a minute is hung, however early in the call it is. So:
//
//   • **the bound becomes IDLE time**, not total time — silence between chunks, not duration;
//   • **a stall keeps what already arrived** — the accumulated text and tool calls are returned as a
//     TRUNCATED turn, which is the same recoverable shape a token-limit cut produces, and the
//     truncation guard already names the file that was lost. Partial beats nothing, every time.
//
// ⚠️ THIS MODULE IS PURE — no SDK, no network, no clock of its own (the caller passes `now`). The
// accumulator's ONLY output is an `OpenAiCompletionLike`, the exact shape the non-streaming path
// already produces, so `parseOpenAiCompletion` stays the single translation and the two paths cannot
// drift into disagreeing about what a turn meant. That is deliberate: the translation is the
// breakage-prone part, and this change does not touch it.

import type { OpenAiCompletionLike, OpenAiToolCall } from './OpenAiToolAdapter';

/** One streamed chunk, structurally (we depend on fields, never on an SDK type). */
export interface OpenAiStreamChunkLike {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      /** GLM/Kimi stream their reasoning here, separately from content — see OpenAiToolAdapter. */
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  /** Present on the final chunk when the request asked for `stream_options.include_usage`. */
  usage?: OpenAiCompletionLike['usage'];
}

/** Why a streamed read stopped. */
export type StreamStopCause =
  /** The provider closed the stream itself — a complete answer. */
  | 'complete'
  /** No chunk arrived for the idle bound — the provider went quiet mid-answer. */
  | 'idle'
  /** The caller's own budget/ceiling ran out while chunks were still arriving. */
  | 'deadline';

/**
 * Accumulates streamed deltas into the SAME completion shape the non-streaming call returns.
 *
 * Tool-call arguments arrive as fragments across many chunks, keyed by `index`; `id` and `name`
 * usually appear only on the first fragment of each call. Anything else would produce a tool call
 * with an empty name, which dispatches to nothing.
 */
export class OpenAiStreamAccumulator {
  private text = '';
  private reasoning = '';
  private finishReason: string | null = null;
  private model: string | undefined;
  private usage: OpenAiCompletionLike['usage'] | undefined;
  /** Keyed by the stream's `index` so out-of-order or interleaved calls cannot merge. */
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();
  private chunks = 0;

  /** Feed one chunk. Tolerant by construction: an unrecognised chunk advances nothing and throws nothing. */
  push(chunk: OpenAiStreamChunkLike | null | undefined): void {
    if (!chunk || typeof chunk !== 'object') return;
    this.chunks += 1;
    if (typeof chunk.model === 'string' && chunk.model) this.model = chunk.model;
    // Usage rides the final chunk; never let a later empty one erase it.
    if (chunk.usage && typeof chunk.usage === 'object') this.usage = chunk.usage;

    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (!choice) return;
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      this.finishReason = choice.finish_reason;
    }

    const delta = choice.delta;
    if (!delta || typeof delta !== 'object') return;
    if (typeof delta.content === 'string') this.text += delta.content;
    if (typeof delta.reasoning_content === 'string') this.reasoning += delta.reasoning_content;

    if (!Array.isArray(delta.tool_calls)) return;
    for (const tc of delta.tool_calls) {
      if (!tc || typeof tc !== 'object') continue;
      const index = typeof tc.index === 'number' && Number.isFinite(tc.index) ? tc.index : 0;
      const current = this.calls.get(index) ?? { id: '', name: '', args: '' };
      if (typeof tc.id === 'string' && tc.id) current.id = tc.id;
      const fn = tc.function;
      if (fn && typeof fn === 'object') {
        if (typeof fn.name === 'string' && fn.name) current.name = fn.name;
        if (typeof fn.arguments === 'string') current.args += fn.arguments;
      }
      this.calls.set(index, current);
    }
  }

  /** The visible text seen so far — what an incremental `onText` has already been handed. */
  textSoFar(): string {
    return this.text;
  }

  /** Did the provider send anything at all, reasoning included? */
  hasContent(): boolean {
    return Boolean(this.text) || Boolean(this.reasoning) || this.calls.size > 0;
  }

  /**
   * Is there a partial ANSWER worth keeping — real text or a tool call?
   *
   * ⚠️ Reasoning deliberately does NOT count. A provider that streamed nothing but its own thinking
   * and then went silent has produced nothing to salvage and nothing to continue from, so that is a
   * failure of the rung (the chain falls to the next vendor) rather than a truncated answer. This is
   * the same distinction `reasoningOnly` draws in the adapter, applied to a stall.
   */
  hasAnswer(): boolean {
    return Boolean(this.text) || this.calls.size > 0;
  }

  /** How many chunks arrived. Zero means the provider never began answering. */
  chunkCount(): number {
    return this.chunks;
  }

  /** True when the stream carried no `usage` — the caller must NEVER invent one (ONE-WALLET LAW). */
  usageMissing(): boolean {
    return this.usage === undefined;
  }

  /**
   * The accumulated turn, in the exact shape `parseOpenAiCompletion` already reads.
   *
   * 🔴 A STALL IS REPORTED AS `length`, AND THAT IS THE WHOLE POINT. `length` is the vocabulary the
   * rest of the engine already has for "this answer was cut off mid-flight": the adapter salvages the
   * file path out of a half-written `write_file`, `truncated` is set, and the truncation guard names
   * the one file that was lost so the next turn rewrites it. A stalled stream is exactly that
   * situation, so it reuses exactly that path rather than inventing a second dialect for it.
   */
  toCompletion(stop: StreamStopCause): OpenAiCompletionLike {
    const toolCalls: OpenAiToolCall[] = [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args },
      }))
      // A fragment that never carried a name cannot be dispatched to anything; dropping it is
      // honest, and keeping it would surface as a mystery "unknown tool" failure downstream.
      .filter((c) => Boolean(c.function.name));

    const finish = stop === 'complete' ? (this.finishReason ?? 'stop') : 'length';

    return {
      ...(this.model ? { model: this.model } : {}),
      choices: [{
        message: {
          role: 'assistant',
          content: this.text || null,
          ...(this.reasoning ? { reasoning_content: this.reasoning } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finish,
      }],
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }
}

// ── The clock ────────────────────────────────────────────────────────────────────────────────────

/**
 * Silence, in ms, after which a streaming provider is treated as stalled.
 *
 * 60 s is deliberately generous: a reasoning model streams its `reasoning_content` while it thinks,
 * so a working provider is nearly always emitting SOMETHING. A minute of total silence is a provider
 * that has stopped, not one that is slow. Compare with what it replaces — a 150 s TOTAL bound that
 * killed providers which had been emitting tokens the whole time.
 */
export const STREAM_IDLE_MS_DEFAULT = 60_000;

/**
 * The absolute ceiling on ONE streamed call, whatever the idle clock says.
 *
 * 300 s sits under the 480 s build-turn budget with room for the next rung, so a single slow provider
 * still cannot eat a whole turn. The caller's own deadline SHORTENS this whenever it is nearer —
 * `turnDeadline` remains the authority on the lane's budget and this never overrides it.
 */
export const STREAM_HARD_CAP_MS_DEFAULT = 300_000;

function envMs(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function streamIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  return envMs(env.AGENTV3_STREAM_IDLE_MS, STREAM_IDLE_MS_DEFAULT);
}

export function streamHardCapMs(env: NodeJS.ProcessEnv = process.env): number {
  return envMs(env.AGENTV3_STREAM_HARD_CAP_MS, STREAM_HARD_CAP_MS_DEFAULT);
}

/**
 * Is streamed reading on?
 *
 * ⚠️ THE CODE DEFAULT IS OFF, and that is not timidity — this is the path that carries every build on
 * the cheap floor. Unset means the pre-change behaviour to the byte: one non-streaming call, the total
 * clock, the existing ceiling. An env var is the switch precisely so it reverts with no deploy (the
 * same reasoning `AGENTV3_STREAMING_PREVIEW` shipped on).
 *
 * ⚠️ WHETHER IT IS ON IN PRODUCTION IS NOT A FACT THIS COMMENT MAY STATE — a deployment claim in a
 * source comment is unverifiable here and goes stale silently (`tsc` and `vitest` cannot read a
 * comment). The CLAUDE.md env registry is the one place that records it.
 */
export function buildStreamingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_STREAM_BUILD_CALLS ?? '').trim().toLowerCase() === 'on';
}
