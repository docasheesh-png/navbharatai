// AgentV3 — Gemini/Vertex tool-use adapter (multi-provider cost routing, phase 1).
//
// Translates v5.0's canonical ANTHROPIC transcript + tool definitions INTO the Google
// GenAI (`@google/genai`) function-calling shape, and the Gemini reply BACK into an
// Anthropic-shaped TurnResult — so a cheap Gemini/Vertex model can take a turn in the
// build loop. PURE and provider-agnostic (no SDK import, no network) so the translation
// is fully unit-testable without a key.
//
// Two Gemini quirks this handles:
//  1. Gemini has NO tool-call IDs — a functionResponse is matched to its call by NAME.
//     Anthropic uses tool_use_id, so we resolve id → name from the preceding model turn
//     when emitting functionResponse parts, and we SYNTHESIZE ids on the way out so the
//     agent loop can still pair tool_use ↔ tool_result internally.
//  2. Gemini's function `parameters` is an OpenAPI subset and rejects some JSON-Schema
//     keys (`$schema`, `additionalProperties`, …), so we sanitize the schema.

import type { ClaudeToolDef, ToolUse, TurnResult, TurnUsage } from '../ClaudeClient';

// ── Minimal structural Gemini shapes ──────────────────────────────────────────────

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}
export interface GeminiTool {
  functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}
export interface GeminiRequest {
  systemInstruction?: string;
  contents: GeminiContent[];
  tools?: GeminiTool[];
}
export interface GeminiResponseLike {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  /** The model that answered (Gemini returns it) — carried into TurnResult.model for REAL-cost billing. */
  modelVersion?: string;
}

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

/** JSON-Schema keys Gemini's function `parameters` rejects; strip them recursively. */
const SCHEMA_STRIP = new Set(['$schema', 'additionalProperties', '$id', 'definitions', '$defs', 'default']);

/** Recursively sanitize a JSON Schema into the OpenAPI subset Gemini accepts. PURE. */
export function sanitizeGeminiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} };
  }
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (SCHEMA_STRIP.has(k)) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
}

/** Convert native Anthropic tool defs to a Gemini `tools` array (functionDeclarations). */
export function toolDefsToGemini(tools: ClaudeToolDef[] | undefined): GeminiTool[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        parameters: sanitizeGeminiSchema(t.input_schema),
      })),
    },
  ];
}

/** Stringify a tool_result block's content for a Gemini functionResponse.response. */
function toolResultObject(content: unknown): Record<string, unknown> {
  if (typeof content === 'string') return { result: content };
  if (Array.isArray(content)) {
    const text = content
      .map((b) => (b && typeof b === 'object' && (b as AnthropicBlock).type === 'text' ? (b as AnthropicBlock).text ?? '' : ''))
      .filter(Boolean)
      .join('\n');
    return { result: text || JSON.stringify(content) };
  }
  if (content && typeof content === 'object') return content as Record<string, unknown>;
  return { result: String(content ?? '') };
}

/**
 * Translate the Anthropic transcript (+ optional system prompt) into a Gemini request.
 * Resolves tool_use_id → function name (Gemini matches results by name) using a running
 * map of ids seen in model turns.
 */
export function transcriptToGemini(messages: unknown[], system?: string): GeminiRequest {
  const contents: GeminiContent[] = [];
  const idToName = new Map<string, string>();
  if (Array.isArray(messages)) {
    for (const raw of messages) {
      const m = raw as AnthropicMessage;
      const isAssistant = m.role === 'assistant';

      if (typeof m.content === 'string') {
        contents.push({ role: isAssistant ? 'model' : 'user', parts: [{ text: m.content }] });
        continue;
      }
      if (!Array.isArray(m.content)) continue;
      const blocks = m.content as AnthropicBlock[];

      if (isAssistant) {
        const parts: GeminiPart[] = [];
        for (const b of blocks) {
          if (b.type === 'text' && b.text) parts.push({ text: b.text });
          else if (b.type === 'tool_use') {
            if (b.id && b.name) idToName.set(b.id, b.name);
            parts.push({ functionCall: { name: b.name ?? '', args: b.input ?? {} } });
          }
        }
        if (parts.length) contents.push({ role: 'model', parts });
        continue;
      }

      // user turn: tool_result blocks → functionResponse parts; text → text parts.
      const parts: GeminiPart[] = [];
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const name = (b.tool_use_id && idToName.get(b.tool_use_id)) || b.tool_use_id || 'tool';
          parts.push({ functionResponse: { name, response: toolResultObject(b.content) } });
        } else if (b.type === 'text' && b.text) {
          parts.push({ text: b.text });
        }
      }
      if (parts.length) contents.push({ role: 'user', parts });
    }
  }
  return { contents, ...(system && system.trim() ? { systemInstruction: system } : {}) };
}

/** Map a Gemini finishReason to the Anthropic stop_reason vocabulary. */
export function mapGeminiFinish(reason: string | undefined, hasToolUse: boolean): string {
  if (hasToolUse) return 'tool_use';
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'STOP':
    case undefined:
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

/**
 * Translate a Gemini response BACK into an Anthropic-shaped TurnResult. Synthesizes a
 * stable tool-call id per functionCall (`gemcall_<i>`) so the agent loop can pair
 * tool_use ↔ tool_result; rawContent stays Anthropic-shaped to preserve the canonical
 * transcript for the next turn.
 */
export function parseGeminiResponse(response: GeminiResponseLike): TurnResult {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  let text = '';
  const toolUses: ToolUse[] = [];
  let i = 0;
  for (const p of parts) {
    if (typeof p.text === 'string') text += p.text;
    else if (p.functionCall) {
      toolUses.push({ id: `gemcall_${i}`, name: p.functionCall.name ?? '', input: p.functionCall.args ?? {} });
      i++;
    }
  }

  const rawContent: unknown[] = [];
  if (text) rawContent.push({ type: 'text', text });
  for (const tu of toolUses) rawContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });

  const usage: TurnUsage = {
    inputTokens: response?.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response?.usageMetadata?.candidatesTokenCount ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  const stopReason = mapGeminiFinish(response?.candidates?.[0]?.finishReason, toolUses.length > 0);
  // Surface the REAL finish reason even when masked to 'tool_use' — a MAX_TOKENS stop that cut off a
  // functionCall mid-arguments must reach the truncation guard (CargoPilot vertex case).
  const truncated = response?.candidates?.[0]?.finishReason === 'MAX_TOKENS';
  return { text, toolUses, stopReason, ...(truncated ? { truncated } : {}), usage, rawContent, ...(typeof response?.modelVersion === 'string' && response.modelVersion ? { model: response.modelVersion } : {}) };
}
