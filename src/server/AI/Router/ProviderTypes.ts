export interface AIProviderResponse {
  content: string;
  latencyMs: number;
  provider: 'VERTEX' | 'GEMINI' | 'ANTHROPIC' | 'GROK';
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
  name: 'VERTEX' | 'GEMINI' | 'ANTHROPIC' | 'GROK';
  priority: number;
  execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string): Promise<AIProviderResponse>;
  healthCheck(): Promise<boolean>;
}
