// AgentV3 — Gemini/Vertex tool-use TurnRunner (multi-provider cost routing, phase 1).
//
// Implements the TurnRunner contract over the Google GenAI (`@google/genai`) function-
// calling API, so a cheap Gemini/Vertex model can take a turn in v3.0's build loop. The
// Anthropic⇄Gemini translation lives in GeminiToolAdapter (pure + tested); this runner is
// the thin I/O layer. The client is injectable (structural) so it is fully unit-testable
// without a network call or key. Errors propagate so the orchestrator can fall through.

import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';
import {
  toolDefsToGemini,
  transcriptToGemini,
  parseGeminiResponse,
  type GeminiContent,
  type GeminiResponseLike,
  type GeminiTool,
} from './GeminiToolAdapter';

/** The narrow slice of the @google/genai SDK the runner needs (DI/tests). */
export interface GeminiGenAiClient {
  models: {
    generateContent(params: {
      model: string;
      contents: GeminiContent[];
      config?: { systemInstruction?: string; tools?: GeminiTool[]; maxOutputTokens?: number };
    }): Promise<GeminiResponseLike>;
  };
}

export interface GeminiToolRunnerOptions {
  /** Gemini model id, e.g. 'gemini-2.5-flash' (cheap) or 'gemini-2.5-pro'. */
  model?: string;
  defaultMaxTokens?: number;
}

/**
 * A TurnRunner backed by a Google GenAI client with native function calling. Works for
 * both Gemini (direct, GEMINI_API_KEY) and Vertex (same content/tool shape) when wired
 * with the corresponding client.
 */
export class GeminiToolRunner implements TurnRunner {
  constructor(
    private readonly client: GeminiGenAiClient,
    private readonly opts: GeminiToolRunnerOptions = {},
  ) {}

  async runTurn(params: RunTurnParams): Promise<TurnResult> {
    const { systemInstruction, contents } = transcriptToGemini(params.messages, params.system);
    const tools = toolDefsToGemini(params.tools);

    const config: { systemInstruction?: string; tools?: GeminiTool[]; maxOutputTokens?: number } = {
      maxOutputTokens: params.maxTokens ?? this.opts.defaultMaxTokens ?? 8000,
    };
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (tools) config.tools = tools;

    const response = await this.client.models.generateContent({
      model: this.opts.model || params.model,
      contents,
      config,
    });

    const result = parseGeminiResponse(response);
    if (params.onText && result.text) params.onText(result.text);
    return result;
  }
}
