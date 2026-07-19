import Anthropic from '@anthropic-ai/sdk';
import { modelSupportsAdaptiveThinking } from './models';
import { claudeBlockedInZone, NoClaudeInWeakBuildError } from './noClaudeZone';

/**
 * ClaudeClient — the v5.0 engine's wrapper over the Anthropic SDK for native
 * tool-use turns (RC-1). One `runTurn()` call = one assistant turn: send the
 * transcript + tool definitions, get back the assistant's text, any `tool_use`
 * blocks, the stop reason, and token usage (for D5 billing).
 *
 * The underlying client is injectable so the loop is fully unit-testable without
 * a live API key. A real Anthropic client is created lazily only when no client
 * is injected (i.e. in production), so importing/constructing this in tests costs
 * nothing and never needs a key.
 */

/** A native Anthropic tool definition (name + JSON-schema input). */
export interface ClaudeToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Deduplicate tool definitions by name, keeping the FIRST occurrence. The Anthropic API rejects a
 * `tools` array with duplicate names as a HARD 400 ("tools: Tool names must be unique.") that kills the
 * whole provider-fallback chain (deep-test 2026-07-18: a drifted duplicate `typecheck` def took down a
 * finished build's Claude heal pass — GLM/Kimi tolerate the dup, Anthropic does not). Canonical home is
 * here, next to ClaudeToolDef; enforced both at tool-array ASSEMBLY (catalogForTools) and at this API
 * client (runTurn) so no upstream duplicate can ever break a build again. Pure.
 */
export function dedupeToolsByName(tools: ClaudeToolDef[]): ClaudeToolDef[] {
  const seen = new Set<string>();
  const out: ClaudeToolDef[] = [];
  for (const t of tools) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    out.push(t);
  }
  return out;
}

/** A parsed `tool_use` block the agent must execute. */
export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Token usage for one turn (drives CostGuard + D5 billing). */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface TurnResult {
  /** Concatenated text blocks (assistant's visible message / thinking). */
  text: string;
  /** Tool calls the agent requested this turn (possibly several = parallel). */
  toolUses: ToolUse[];
  /** Anthropic stop reason: 'end_turn' | 'tool_use' | 'max_tokens' | … */
  stopReason: string | null;
  /**
   * TRUE when the provider stopped because it hit the output-token limit (Anthropic 'max_tokens',
   * OpenAI/GLM/Kimi finish_reason 'length', Gemini 'MAX_TOKENS') — REGARDLESS of whether the turn also
   * emitted tool calls. `stopReason` alone is insufficient: the OpenAI/Gemini adapters force `'tool_use'`
   * whenever a tool call is present, which MASKS a truncation that happened mid-`write_file` (the exact
   * CargoPilot kimi/vertex case) — leaving the truncation guard blind and a partial file on disk. This
   * flag surfaces the real finish reason so the loop can recover. Optional (undefined = not truncated).
   */
  truncated?: boolean;
  usage: TurnUsage;
  /** Raw assistant content blocks, to append verbatim to the transcript (RC-2). */
  rawContent: unknown[];
  /**
   * The model id that ACTUALLY produced this turn, when the runner knows it (REAL-cost billing prices
   * on the exact model — a GLM flash turn is free, a glm-5.2 turn is the flagship rate). Optional:
   * runners that don't report it leave it undefined and billing falls back to the provider-label rate.
   */
  model?: string;
}

export interface RunTurnParams {
  model: string;
  system?: string;
  /** The growing transcript (Anthropic MessageParam[]). Typed as unknown[] so the
   *  loop owns the shape and tests can pass plain objects. */
  messages: unknown[];
  tools?: ClaudeToolDef[];
  maxTokens?: number;
  /**
   * Enable Anthropic prompt caching of the large, constant prefix (tool
   * definitions + system prompt) via cache_control: ephemeral (RC-2). Default
   * true. Cuts input-token cost on every turn after the first → directly widens
   * the D5 margin. The Anthropic prompt prefix order is tools → system →
   * messages, so a cache breakpoint on the system block caches tools+system.
   */
  cache?: boolean;
  /**
   * Enable Anthropic adaptive "thinking" with a summarized display for this turn.
   * When set, the model reasons before answering and emits a thinking summary the
   * UI can stream (via `onThinking`). Off by default — backward compatible.
   */
  thinking?: boolean;
  /**
   * Opus reasoning effort (output_config.effort): low | medium | high | xhigh | max.
   * Controls thinking depth + token spend on Opus 4.8 (budget_tokens is removed there).
   * Only send for Opus/Sonnet-4.6 runs — effort errors on Haiku 4.5. Omitted → model default.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * Optional streaming callback for the assistant's visible text. When provided
   * (and the underlying client supports streaming), the turn streams and each
   * text delta is delivered here token-by-token. Omitting it keeps the original
   * non-streaming behaviour unchanged.
   */
  onText?: (delta: string) => void;
  /**
   * Optional streaming callback for the thinking summary. Receives thinking
   * deltas token-by-token when `thinking` is on and streaming is active.
   */
  onThinking?: (delta: string) => void;
}

/** The slice of ClaudeClient the AgentRunner loop depends on (DI/testing). */
export interface TurnRunner {
  runTurn(params: RunTurnParams): Promise<TurnResult>;
}

/** Minimal structural type of the Anthropic client method we use (for DI/tests). */
export interface MessagesCreateClient {
  messages: {
    create(params: Record<string, unknown>): Promise<AnthropicMessageLike>;
    /**
     * Optional streaming entry point. When present, runTurn uses it to emit
     * text/thinking deltas live; the final assembled message is awaited via
     * `finalMessage()`. The real Anthropic SDK provides this; tests can inject it.
     */
    stream?(params: Record<string, unknown>): AsyncIterable<unknown> & {
      finalMessage(): Promise<AnthropicMessageLike>;
    };
  };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  [k: string]: unknown;
}

interface AnthropicMessageLike {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  /** The model that produced the message (Anthropic echoes it back) — carried into TurnResult.model. */
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** Retry policy for transient provider errors (rate limits, overload, 5xx, network). */
export interface RetryOptions {
  /** Max retries after the first attempt. Default 5. */
  maxRetries?: number;
  /** Base backoff in ms (exponential + jitter). Default 1000. */
  baseDelayMs?: number;
  /** Injectable sleep (tests pass a no-op). Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sanitize an env-supplied API key. Pasting a key into a Cloud Run variable
 * often introduces a trailing newline/space or wrapping quotes; the Anthropic
 * SDK sends the value verbatim, so an otherwise-valid key then 401s on every
 * call. Strip surrounding whitespace and a single layer of wrapping quotes.
 */
export function sanitizeApiKey(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the Anthropic endpoint for AgentV3. ALWAYS returns an explicit URL so
 * the SDK never falls back to the ambient `ANTHROPIC_BASE_URL` (the shared
 * aicredits proxy) — posting native tool-use there yields "404 page not found".
 * Honours an explicit Anthropic-compatible AgentV3 override when set.
 */
export function resolveAnthropicBaseUrl(): string {
  const override = process.env.AGENTV3_ANTHROPIC_BASE_URL?.trim().replace(/\/v1$/, '');
  return override && override.length > 0 ? override : 'https://api.anthropic.com';
}

/**
 * Per-request HTTP timeout (ms) for a single Claude call. The Anthropic SDK's DEFAULT scales with
 * max_tokens and can be ~10 minutes — so one stalled request (a connection that opens but never
 * responds) silently hangs the whole build for minutes. We pin a much shorter cap so a stalled call
 * fails FAST and our own retry/fallback kicks in, instead of the build spinning at "working…".
 * Env-tunable via AGENTV3_LLM_TIMEOUT_MS; default 120 s (well above any healthy turn, far below 10 min).
 */
export function llmRequestTimeoutMs(): number {
  const raw = Number(process.env.AGENTV3_LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
}

/**
 * Add a prompt-cache breakpoint on the GROWING transcript (RC-2 fast-follow).
 *
 * The Anthropic prompt prefix is tools → system → messages. runTurn already caches the
 * (constant) tools+system via a breakpoint on the system block. But the `messages` array — the
 * transcript that grows every turn with full file contents, tool_results and screenshots — was
 * NEVER cached, so every turn re-billed and re-processed the entire prior conversation as fresh
 * input (~1-3s extra time-to-first-token past ~20-40k tokens, and the dominant input-cost leak).
 *
 * This stamps a single `cache_control: ephemeral` breakpoint on the LAST content block of the LAST
 * message. Because caching is prefix-based, each turn's transcript is a prefix of the next, so the
 * stable head is a cache READ (0.1x) and only the new suffix is a cache WRITE (1.25x) → ~5-7x
 * cheaper input on a long build AND a faster first token. Stale breakpoints on older messages are
 * stripped first so the total never exceeds Anthropic's 4-breakpoint limit as the transcript grows
 * (this + the system breakpoint = 2). Returns a shallow-cloned array — never mutates the caller's
 * transcript. A too-short prefix (< the model's cache minimum) is ignored by Anthropic gracefully.
 */
export function withTranscriptCacheBreakpoint(messages: unknown[]): unknown[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const cloned = messages.map((m) => {
    const msg = m as { role?: unknown; content?: unknown };
    if (Array.isArray(msg.content)) {
      const blocks = msg.content.map((b) => {
        if (b && typeof b === 'object' && 'cache_control' in (b as Record<string, unknown>)) {
          const { cache_control: _drop, ...rest } = b as Record<string, unknown>;
          return rest;
        }
        return b;
      });
      return { ...msg, content: blocks };
    }
    return { ...msg };
  });
  const last = cloned[cloned.length - 1] as { content?: unknown };
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }];
  } else if (Array.isArray(last.content) && last.content.length > 0) {
    const blocks = last.content as Record<string, unknown>[];
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } };
  }
  return cloned;
}

export class ClaudeClient implements TurnRunner {
  private client?: MessagesCreateClient;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(client?: MessagesCreateClient, retry?: RetryOptions) {
    this.client = client;
    this.maxRetries = retry?.maxRetries ?? 5;
    this.baseDelayMs = retry?.baseDelayMs ?? 1000;
    this.sleep = retry?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private getClient(): MessagesCreateClient {
    if (!this.client) {
      // AgentV3 talks to the NATIVE Anthropic API (messages.create with tools)
      // and authenticates with the platform's own ANTHROPIC_API_KEY via the
      // x-api-key header. It must NOT inherit the shared ANTHROPIC_BASE_URL:
      // that points at an OpenAI-compatible proxy (aicredits.in), so posting the
      // native messages.create there returns "404 page not found" and every
      // Claude turn fails (the engine then silently falls back to Vertex/Gemini).
      //
      // CRITICAL: the Anthropic SDK reads `ANTHROPIC_BASE_URL` from the env when
      // no `baseURL` is passed — so leaving it unset is NOT enough to avoid the
      // proxy. We must ALWAYS pin an explicit baseURL: the real Anthropic
      // endpoint by default, or an explicit Anthropic-compatible AgentV3 override
      // (e.g. a real Anthropic gateway) when one is set.
      this.client = new Anthropic({
        apiKey: sanitizeApiKey(process.env.ANTHROPIC_API_KEY),
        baseURL: resolveAnthropicBaseUrl(),
        // Pin a sane per-request timeout so a stalled call fails fast (the SDK default is ~10 min).
        timeout: llmRequestTimeoutMs(),
        // Our own createWithRetry owns retries with backoff — disable the SDK's internal retry layer
        // so a stall isn't multiplied (SDK 2× × our retries) into many minutes of compounded waiting.
        maxRetries: 0,
      }) as unknown as MessagesCreateClient;
    }
    return this.client;
  }

  /** Run one assistant turn with optional native tools. */
  async runTurn(params: RunTurnParams): Promise<TurnResult> {
    // UNBREAKABLE WEAK-MODULE GUARD (admin absolute rule, 2026-07-13). This is the ONE chokepoint where
    // every Claude call — builder, judge, plan, any heal gate, whether or not the call site remembered to
    // thread a flag — must pass. When a weak/free build is in progress a no-Claude zone is active, and
    // Claude is refused here BEFORE a single token is spent. See noClaudeZone.ts for why this lives at the
    // invocation point rather than at N call sites (root cause of the App #3 leak: a raw ClaudeClient that
    // bypassed the enforceNoClaude chain guard). The refusal is a normal error: a provider chain falls
    // through to the next (non-Claude) provider; a best-effort heal gate simply skips.
    if (claudeBlockedInZone(params.model)) {
      throw new NoClaudeInWeakBuildError(params.model);
    }
    const cache = params.cache !== false; // default ON
    const createParams: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 8192,
      // Cache the growing transcript too (not just tools+system) — see withTranscriptCacheBreakpoint.
      messages: cache ? withTranscriptCacheBreakpoint(params.messages) : params.messages,
    };

    const hasTools = !!params.tools && params.tools.length > 0;

    if (params.system) {
      // Cache the (large, constant) system prompt. A breakpoint here also caches
      // the tool block that precedes it in the prompt prefix.
      createParams.system = cache
        ? [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }]
        : params.system;
    }

    if (hasTools) {
      // INVARIANT: the Anthropic API rejects duplicate tool names as a HARD 400 ("tools: Tool names must
      // be unique.") that kills the entire provider-fallback chain (deep-test 2026-07-18). Dedupe by name
      // at this single boundary every provider call passes through, so a duplicate from ANY caller can
      // never break a build — belt-and-suspenders alongside catalogForTools' own dedupe.
      const tools = dedupeToolsByName(params.tools as ClaudeToolDef[]);
      if (cache && !params.system) {
        // No system block to carry the breakpoint → mark the last tool instead.
        createParams.tools = tools.map((t, i) =>
          i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t,
        );
      } else {
        createParams.tools = tools;
      }
      createParams.tool_choice = { type: 'auto' };
    }

    // Extended-reasoning params (adaptive thinking + output_config.effort) are ONLY valid on Opus 4.x
    // and Sonnet 4.6+. Sending them to a model that doesn't support them (Haiku, or the forced-Haiku
    // CLAUDE_HAIKU backstop) is a HARD 400 "adaptive thinking is not supported on this model" that kills
    // the whole provider-fallback chain — the real BUILD_ERROR from the 2026-07-05 build report. Gate
    // both by model capability (single source of truth in models.ts) so a cheap/fallback tier degrades
    // gracefully (no reasoning display) instead of failing the turn outright.
    const extendedReasoning = modelSupportsAdaptiveThinking(params.model);

    if (params.thinking && extendedReasoning) {
      // Adaptive thinking with a summarized display — the correct shape for
      // claude-opus-4-8 / claude-sonnet-4-6 (do NOT use budget_tokens here).
      createParams.thinking = { type: 'adaptive', display: 'summarized' };
    }

    if (params.effort && extendedReasoning) {
      // Opus 4.8 reasoning-effort lever (GA, no beta header). Drives the power tiers
      // (mini=low / medium=medium / max=max). Only set for Opus / Sonnet 4.6 runs.
      createParams.output_config = { effort: params.effort };
    }

    // Stream the turn when a streaming callback is provided AND the client
    // supports it. A transient streaming failure falls back to the proven
    // non-streaming path so a turn never dies just because streaming broke.
    if ((params.onText || params.onThinking) && typeof this.getClient().messages.stream === 'function') {
      try {
        return await this.streamTurn(createParams, params);
      } catch (err) {
        if (!isRetryableError(err)) throw err;
        // Fall through to the non-streaming path below on a transient error.
      }
    }

    const resp = await this.createWithRetry(createParams);
    return parseMessage(resp);
  }

  /**
   * Stream one assistant turn, delivering text/thinking deltas live via the
   * caller's callbacks, then parse the final assembled message into a TurnResult.
   */
  private async streamTurn(
    createParams: Record<string, unknown>,
    params: RunTurnParams,
  ): Promise<TurnResult> {
    const stream = this.getClient().messages.stream!(createParams);
    for await (const event of stream) {
      const e = event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
      if (e.type === 'content_block_delta' && e.delta) {
        if (e.delta.type === 'text_delta' && typeof e.delta.text === 'string' && params.onText) {
          params.onText(e.delta.text);
        } else if (e.delta.type === 'thinking_delta' && typeof e.delta.thinking === 'string' && params.onThinking) {
          params.onThinking(e.delta.thinking);
        }
      }
    }
    const finalMessage = await stream.finalMessage();
    return parseMessage(finalMessage);
  }

  /**
   * Call the API with exponential backoff on transient errors (429 rate limit,
   * 529 overloaded, 5xx, network/timeout). Non-transient errors (400/401/403/404
   * and programming errors) fail fast. Honours a Retry-After header when present.
   * This keeps a long multi-step build alive through provider hiccups instead of
   * dying on the first blip.
   */
  private async createWithRetry(createParams: Record<string, unknown>): Promise<AnthropicMessageLike> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.getClient().messages.create(createParams);
      } catch (err) {
        attempt++;
        if (attempt > this.maxRetries || !isRetryableError(err)) throw err;
        await this.sleep(retryDelayMs(err, attempt, this.baseDelayMs));
      }
    }
  }
}

function errStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    const resp = e.response as Record<string, unknown> | undefined;
    if (resp && typeof resp.status === 'number') return resp.status;
  }
  return undefined;
}

/** True for transient errors worth retrying. */
export function isRetryableError(err: unknown): boolean {
  const status = errStatus(err);
  if (typeof status === 'number') {
    return status === 408 || status === 409 || status === 429 || status === 529 || status >= 500;
  }
  // No HTTP status → treat connection/timeout style errors as transient.
  const name = err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string'
    ? String((err as { name?: unknown }).name)
    : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /connection|timeout|econnreset|enotfound|socket|network|fetch failed|overload/i.test(
    `${name} ${msg}`,
  );
}

function retryAfterSeconds(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as { headers?: unknown; response?: { headers?: unknown } };
    const headers = e.headers ?? e.response?.headers;
    if (headers && typeof headers === 'object') {
      const h = headers as { get?: (k: string) => unknown; [k: string]: unknown };
      const raw = typeof h.get === 'function' ? h.get('retry-after') : h['retry-after'];
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return undefined;
}

function retryDelayMs(err: unknown, attempt: number, baseDelayMs: number): number {
  const retryAfter = retryAfterSeconds(err);
  if (retryAfter !== undefined) return Math.min(retryAfter * 1000, 60_000);
  const expo = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(expo + jitter, 30_000);
}

/** Parse a raw Anthropic message into the engine's TurnResult shape. */
export function parseMessage(resp: AnthropicMessageLike): TurnResult {
  const content = Array.isArray(resp.content) ? resp.content : [];
  let text = '';
  const toolUses: ToolUse[] = [];

  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      toolUses.push({
        id: block.id,
        name: block.name,
        input: (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>,
      });
    }
  }

  const u = resp.usage ?? {};
  return {
    text,
    toolUses,
    stopReason: resp.stop_reason ?? null,
    ...(resp.stop_reason === 'max_tokens' ? { truncated: true } : {}),
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    },
    rawContent: content,
    ...(typeof resp.model === 'string' && resp.model ? { model: resp.model } : {}),
  };
}
