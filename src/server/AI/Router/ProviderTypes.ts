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
  execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string, images?: string[]): Promise<AIProviderResponse>;
  healthCheck(): Promise<boolean>;
  executeStream?(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string>;
}
