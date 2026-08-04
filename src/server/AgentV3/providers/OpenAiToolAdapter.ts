// AgentV3 — OpenAI-compatible tool-use adapter (multi-provider cost routing, phase 1).
//
// v5.0's agent loop keeps its canonical transcript in ANTHROPIC shape (each turn's
// rawContent is appended verbatim as Anthropic content blocks). To let a cheaper,
// OpenAI-compatible provider (Grok / any OpenAI-style endpoint) take a turn, we must
// translate that Anthropic transcript + tool definitions INTO the OpenAI Chat
// Completions shape on the way in, and translate the OpenAI assistant reply BACK into
// an Anthropic-shaped TurnResult (text + tool_use blocks) on the way out. Keeping the
// canonical transcript Anthropic-shaped is what lets Claude and a cheaper provider
// interleave turn-by-turn in the same build.
//
// This module is PURE and provider-agnostic (no SDK import, no network) so the
// translation — the intricate, breakage-prone part — is fully unit-testable without
// any live key. The runner that actually calls a provider wraps these functions.

import type { ClaudeToolDef, ToolUse, TurnResult, TurnUsage } from '../ClaudeClient';

// ── Minimal structural OpenAI shapes (we depend on fields, not the SDK types) ──────

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface OpenAiCompletionLike {
  /** The model that answered (OpenAI-compatible APIs echo it) — carried into TurnResult.model so
   *  REAL-cost billing prices the exact GLM/Kimi rung that ran (flash-free vs flagship). */
  model?: string;
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** OpenAI-compatible prefix-cache hit count. GLM (Z.ai) and Kimi (Moonshot) auto-cache a repeated
     *  prompt prefix and report the hit here; some providers put it at the top-level `cached_tokens`.
     *  `prompt_tokens` INCLUDES these. Capturing it reveals the real cache-hit rate on cheap-floor builds. */
    prompt_tokens_details?: { cached_tokens?: number };
    cached_tokens?: number;
  };
}

// ── Anthropic transcript block shapes (the canonical format) ──────────────────────

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

interface AnthropicMessage {
  role?: string;
  content?: unknown;
}

/** Convert native Anthropic tool definitions to OpenAI `tools` (function defs). */
export function toolDefsToOpenAI(tools: ClaudeToolDef[] | undefined): OpenAiTool[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: (t.input_schema as unknown as Record<string, unknown>) ?? {
        type: 'object',
        properties: {},
      },
    },
  }));
}

/** Stringify a tool_result block's content (string passthrough; else JSON). */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Anthropic tool_result content can be an array of {type:'text',text} blocks.
    const text = content
      .map((b) => (b && typeof b === 'object' && (b as AnthropicBlock).type === 'text' ? (b as AnthropicBlock).text ?? '' : ''))
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  try {
    return JSON.stringify(content ?? '');
  } catch {
    return String(content ?? '');
  }
}

/**
 * Translate the Anthropic-shaped transcript (+ optional system prompt) into an
 * OpenAI Chat Completions `messages` array. Tool-use/tool-result blocks are mapped to
 * OpenAI `assistant.tool_calls` / `role:'tool'` messages so a function-calling model
 * sees a well-formed conversation.
 */
export function transcriptToOpenAI(messages: unknown[], system?: string): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  if (system && system.trim()) out.push({ role: 'system', content: system });
  if (!Array.isArray(messages)) return out;

  for (const raw of messages) {
    const m = raw as AnthropicMessage;
    const role = m.role === 'assistant' ? 'assistant' : 'user';

    if (typeof m.content === 'string') {
      out.push({ role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;

    const blocks = m.content as AnthropicBlock[];

    if (role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      const toolCalls: OpenAiToolCall[] = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: b.id ?? '',
          type: 'function',
          function: { name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) },
        }));
      const msg: OpenAiMessage = { role: 'assistant', content: text || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
      continue;
    }

    // role === 'user': may carry tool_result blocks (→ tool messages) and/or text.
    const userText: string[] = [];
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: b.tool_use_id ?? '', content: toolResultText(b.content) });
      } else if (b.type === 'text') {
        userText.push(b.text ?? '');
      }
    }
    if (userText.length) out.push({ role: 'user', content: userText.join('') });
  }
  return out;
}

/** Map an OpenAI finish_reason to the Anthropic stop_reason vocabulary. */
export function mapFinishReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'stop':
      return 'end_turn';
    default:
      return reason ?? 'end_turn';
  }
}

/**
 * Salvage the FILE PATH from a tool-call arguments JSON that was cut off mid-string by the provider's
 * output-token limit (finish_reason 'length'). A truncated write_file looks like
 * `{"path":"src/App.tsx","content":"…(cut off here` — the `path` is short and comes FIRST, so it
 * survives the truncation even though the whole payload no longer parses. Recovering it lets the
 * truncation guard NAME the exact file that was lost (instead of a bare "Unterminated string in JSON"
 * with no file identity) so the very next turn rewrites it. Deliberately salvages ONLY the path — never
 * the partial `content` — so a half-written file can never be persisted from a truncated call. PURE.
 */
export function salvageTruncatedPath(args: string | undefined): string | null {
  if (!args) return null;
  // First top-level "path": "<value>" — bounded so a pathological payload can't hang the regex.
  const m = args.match(/"path"\s*:\s*"((?:[^"\\]|\\.){1,400})"/);
  if (!m) return null;
  try {
    // The captured value may contain JSON escapes (\/, \\) — decode it the same way JSON.parse would.
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1] || null;
  }
}

/**
 * Parse one tool call's arguments JSON; tolerate empty / malformed by returning {}. When `salvage` is on
 * (the turn was truncated at the token limit) and strict parse fails, recover just the file PATH so the
 * truncation guard can name the cut-off file — the call still carries no `content`, so it can only error
 * honestly at dispatch (never write a partial file).
 */
function parseArgs(args: string | undefined, salvage = false): Record<string, unknown> {
  if (!args || !args.trim()) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    if (salvage) {
      const path = salvageTruncatedPath(args);
      if (path) return { path };
    }
    return {};
  }
}

/**
 * Translate an OpenAI chat completion BACK into an Anthropic-shaped TurnResult. The
 * `rawContent` is emitted as Anthropic content blocks (text + tool_use) so appending it
 * keeps the canonical transcript Anthropic-shaped for the next turn (Claude or otherwise).
 */
export function parseOpenAiCompletion(completion: OpenAiCompletionLike): TurnResult {
  const choice = completion?.choices?.[0];
  const message = choice?.message ?? { role: 'assistant', content: null };
  const text = typeof message.content === 'string' ? message.content : '';

  // A `length` finish means the output was cut at the token limit — a write_file's `content` arg can be
  // sliced mid-string, so its arguments no longer parse. Salvage just the path in that case so the
  // truncation guard can name the lost file (never the partial content → no half-written file persists).
  const truncatedTurn = choice?.finish_reason === 'length';
  const toolUses: ToolUse[] = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function?.name ?? '',
        input: parseArgs(tc.function?.arguments, truncatedTurn),
      }))
    : [];

  const rawContent: unknown[] = [];
  if (text) rawContent.push({ type: 'text', text });
  for (const tu of toolUses) rawContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });

  // Capture the prefix-cache hit (previously hardcoded 0 → we were blind to it). GLM/Kimi auto-cache a
  // repeated prefix and report the hit as prompt_tokens_details.cached_tokens (a few report a top-level
  // cached_tokens). prompt_tokens already INCLUDES the cached ones. This drives the report's cache-hit
  // rate so we can SEE whether the big cheap-floor input is cache-served; billing still prices at the
  // full (margin-safe) rate for now — a later slice discounts the cache-read tokens.
  const cachedRead = Math.max(
    0,
    completion?.usage?.prompt_tokens_details?.cached_tokens ?? completion?.usage?.cached_tokens ?? 0,
  );
  const usage: TurnUsage = {
    inputTokens: completion?.usage?.prompt_tokens ?? 0,
    outputTokens: completion?.usage?.completion_tokens ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: cachedRead,
  };

  // If the model returned tool calls, the agent loop must run them: force tool_use.
  const stopReason = toolUses.length ? 'tool_use' : mapFinishReason(choice?.finish_reason);
  // Surface the REAL finish reason even when it was masked to 'tool_use' above — a `length` stop that
  // cut off a write_file mid-arguments must be visible to the truncation guard (CargoPilot kimi case).
  const truncated = choice?.finish_reason === 'length';

  return { text, toolUses, stopReason, ...(truncated ? { truncated } : {}), usage, rawContent, ...(typeof completion?.model === 'string' && completion.model ? { model: completion.model } : {}) };
}
