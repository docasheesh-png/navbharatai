export interface AIProviderResponse {
  content: string;
  latencyMs: number;
  provider: 'VERTEX' | 'GEMINI' | 'ANTHROPIC' | 'GROK' | 'PRO';
  model: string;
}

export interface ProviderTelemetry {
  provider: string;
  retries: number;
  latency: number;
  fallbackReason?: string;
  success: boolean;
}

export interface AIProvider {
  name: 'VERTEX' | 'GEMINI' | 'ANTHROPIC' | 'GROK' | 'PRO';
  priority: number;
  /**
   * When true, this provider is a LAST-RESORT fallback: in a raced router
   * (see AIRouter.routeRaced) it is tried sequentially ONLY after every
   * non-last-resort provider has failed. Used by the PROFESSIONAL universe so
   * Claude is reached only if the Grok/Gemini/Vertex race fails.
   */
  lastResort?: boolean;
  execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string, images?: string[]): Promise<AIProviderResponse>;
  healthCheck(): Promise<boolean>;
  executeStream?(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string>;
}
