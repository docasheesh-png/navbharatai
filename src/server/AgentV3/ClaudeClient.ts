import Anthropic from '@anthropic-ai/sdk';

/**
 * ClaudeClient — the v3.0 engine's wrapper over the Anthropic SDK for native
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
  usage: TurnUsage;
  /** Raw assistant content blocks, to append verbatim to the transcript (RC-2). */
  rawContent: unknown[];
}

export interface RunTurnParams {
  model: string;
  system?: string;
  /** The growing transcript (Anthropic MessageParam[]). Typed as unknown[] so the
   *  loop owns the shape and tests can pass plain objects. */
  messages: unknown[];
  tools?: ClaudeToolDef[];
  maxTokens?: number;
}

/** The slice of ClaudeClient the AgentRunner loop depends on (DI/testing). */
export interface TurnRunner {
  runTurn(params: RunTurnParams): Promise<TurnResult>;
}

/** Minimal structural type of the Anthropic client method we use (for DI/tests). */
export interface MessagesCreateClient {
  messages: { create(params: Record<string, unknown>): Promise<AnthropicMessageLike> };
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
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export class ClaudeClient implements TurnRunner {
  private client?: MessagesCreateClient;

  constructor(client?: MessagesCreateClient) {
    this.client = client;
  }

  private getClient(): MessagesCreateClient {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: process.env.ANTHROPIC_BASE_URL?.replace(/\/v1$/, ''),
      }) as unknown as MessagesCreateClient;
    }
    return this.client;
  }

  /** Run one assistant turn with optional native tools. */
  async runTurn(params: RunTurnParams): Promise<TurnResult> {
    const createParams: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 8192,
      messages: params.messages,
    };
    if (params.system) createParams.system = params.system;
    if (params.tools && params.tools.length > 0) {
      createParams.tools = params.tools;
      createParams.tool_choice = { type: 'auto' };
    }

    const resp = await this.getClient().messages.create(createParams);
    return parseMessage(resp);
  }
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
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    },
    rawContent: content,
  };
}
