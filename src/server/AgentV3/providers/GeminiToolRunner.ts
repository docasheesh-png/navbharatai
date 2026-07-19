// AgentV3 — Gemini/Vertex tool-use TurnRunner (multi-provider cost routing, phase 1).
//
// Implements the TurnRunner contract over the Google GenAI (`@google/genai`) function-
// calling API, so a cheap Gemini/Vertex model can take a turn in v5.0's build loop. The
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
  /**
   * Per-call wall-clock timeout in ms. A stalled Vertex/Gemini call otherwise blocks the whole
   * build (the Google GenAI SDK is constructed without an http timeout), so this bounds it and
   * REJECTS on overrun — the orchestrator then falls through to the next provider (Claude backstop)
   * exactly like every other provider's timeout. Default 120000 (matches the Claude LLM timeout).
   * Set to 0 to disable. (Perf/resilience audit 2026-07-18 — the only provider family missing a timeout.)
   */
  timeoutMs?: number;
}

/** Reject a promise if it does not settle within `ms`. Portable (no SDK/AbortController dependency),
 *  so it bounds ANY injected client. `ms <= 0` disables the bound. Pure + module-local. */
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

    const response = await withTimeout(
      this.client.models.generateContent({
        model: this.opts.model || params.model,
        contents,
        config,
      }),
      this.opts.timeoutMs ?? 120_000,
      `Gemini/Vertex call exceeded ${this.opts.timeoutMs ?? 120_000}ms`,
    );

    const result = parseGeminiResponse(response);
    if (params.onText && result.text) params.onText(result.text);
    return result;
  }
}
