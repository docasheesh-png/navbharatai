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
  | 'deadline'
  /**
   * The provider is ANSWERING, and answering so slowly that waiting for it costs more than moving on.
   *
   * 🔴 THE CASE NOTHING COULD SEE (autopsy 2b0a3ed5, 2026-09-17). A first call took 55.7 seconds and
   * returned 27 output tokens — 0.48 tok/s against the ~33/s our own budget arithmetic assumes — and
   * the user pressed Stop at 66 s. It reached NO escalation path: the timeout bench needs a throw and
   * the call succeeded; the 429 bench needs a 429; the idle bound needs 60 s of TOTAL silence and
   * tokens trickled; the hard cap is 300 s; and the post-call slow bench needs three calls. A stream
   * that is neither healthy nor silent is a THIRD state, and this is its name.
   */
  | 'slow';

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

  /** The provider's own thinking so far, where it streams one. Never part of the ANSWER. */
  reasoningSoFar(): string {
    return this.reasoning;
  }

  /**
   * How much the provider has PRODUCED, counting everything it sent: answer text, tool-call
   * arguments, and its own reasoning.
   *
   * 🔑 REASONING IS COUNTED, AND THAT IS THE WHOLE REASON THIS IS SAFE (autopsy 2b0a3ed5). GLM 5.3+
   * always reasons, and its thinking arrives BEFORE any content — so a throughput floor that watched
   * only `text` would read a perfectly healthy reasoning turn as producing nothing and abandon it, on
   * exactly the tier that reasons most. Counting reasoning makes a working provider look busy,
   * because it IS busy, and leaves only the genuinely crawling one below the line.
   *
   * Characters rather than tokens, deliberately: tokens are not known until the final chunk, and
   * inventing a token count from text length is the estimate the wallet law forbids. This number
   * decides ROUTING, never a bill, and a ratio of characters is the same ratio either way.
   */
  producedChars(): number {
    let total = this.text.length + this.reasoning.length;
    for (const call of this.calls.values()) total += call.name.length + call.args.length;
    return total;
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

/**
 * 🔴 THE THROUGHPUT FLOOR — the third state a streamed call can be in (autopsy 2b0a3ed5, 2026-09-17).
 *
 * Streaming bounded a call by SILENCE, which assumes two kinds of provider: healthy, and stalled. A
 * provider that trickles is a third: it never goes quiet, so the 60 s idle bound never fires, and it
 * always has an answer eventually, so the 300 s ceiling returns a truncated SUCCESS. The reported
 * call sat in that gap for 55.7 seconds and produced 27 tokens.
 *
 * ⚠️ THIS IS DELIBERATELY NOT A SECOND COPY OF `FLOOR_MS_PER_OUTPUT_TOKEN`. That constant sizes a
 * REQUEST (how many tokens fit in a clock) and is well calibrated at 30 ms/token — measured across 73
 * real calls and deliberately left alone. This decides whether to keep WAITING, which is a different
 * question and needs a far more forgiving number: the floor below is roughly one twentieth of the
 * budgeted pace, so a provider merely having a bad minute is nowhere near it.
 */
export const STREAM_MIN_CHARS_PER_SEC = 6;

/**
 * How long a stream is left alone before its rate is judged at all.
 *
 * A provider legitimately spends the first seconds on prompt ingestion and returns nothing — at 26,569
 * input tokens the reported call had real work to do before its first byte. Judging inside that window
 * would abandon healthy calls for being new, so the grace period is what makes the floor a measurement
 * rather than a race.
 */
export const STREAM_THROUGHPUT_GRACE_MS = 15_000;

function streamNumber(value: string | undefined, min: number): number | null {
  // A BLANK value means UNSET, not zero — `Number('')` is 0 (see slowRungBench's own note on this).
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= min ? n : null;
}

/** The configured floor. Junk, blank, or a negative falls back; an explicit `0` disables the guard. */
export function streamMinCharsPerSec(env: NodeJS.ProcessEnv = process.env): number {
  return streamNumber(env.AGENTV3_STREAM_MIN_CHARS_PER_SEC, 0) ?? STREAM_MIN_CHARS_PER_SEC;
}

/** The configured grace period. Never shorter than 5 s — below that the floor is a race, not a reading. */
export function streamThroughputGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  return streamNumber(env.AGENTV3_STREAM_THROUGHPUT_GRACE_MS, 5_000) ?? STREAM_THROUGHPUT_GRACE_MS;
}

/**
 * Is this stream crawling — past its grace period and below the floor? PURE.
 *
 * 🔒 `producedChars` counts REASONING as well as answer text (see `OpenAiStreamAccumulator`), so a
 * forced-reasoning model thinking hard before it writes is never mistaken for a dead one.
 */
export function streamIsCrawling(
  sample: { producedChars: number; elapsedMs: number },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const floor = streamMinCharsPerSec(env);
  if (floor <= 0) return false;
  const elapsedMs = Number.isFinite(sample?.elapsedMs) ? sample.elapsedMs : 0;
  if (elapsedMs < streamThroughputGraceMs(env)) return false;
  const produced = Number.isFinite(sample?.producedChars) ? Math.max(0, sample.producedChars) : 0;
  return produced / (elapsedMs / 1000) < floor;
}

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
