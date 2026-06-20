import { AIProvider, AIProviderResponse } from '../ProviderTypes';
import Anthropic from '@anthropic-ai/sdk';

export class AnthropicProvider implements AIProvider {
  name: 'ANTHROPIC' = 'ANTHROPIC';
  priority = 4;

  private client: Anthropic;
  private readonly modelId: string;

  constructor(modelId = 'claude-3-5-sonnet-20241022') {
    this.modelId = modelId;
    console.log("ANTHROPIC_API_KEY check:", !!process.env.ANTHROPIC_API_KEY);
    this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: process.env.ANTHROPIC_BASE_URL?.replace(/\/v1$/, '')
    });
  }

  async execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string): Promise<AIProviderResponse> {
    const startTime = Date.now();
    const model = modelOverride || this.modelId;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

    const createParams: any = {
      model,
      max_tokens: 8000,
      messages,
    };
    if (systemPrompt) createParams.system = systemPrompt;

    const response = await this.client.messages.create(createParams);

    const content = (response.content[0] as Anthropic.TextBlock).text;

    return {
      content: content,
      latencyMs: Date.now() - startTime,
      provider: 'ANTHROPIC',
      model,
    };
  }

  async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string> {
    const params: any = {
      model: this.modelId,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    };
    if (systemPrompt) params.system = systemPrompt;
    const stream = this.client.messages.stream(params);
    let full = '';
    for await (const event of stream) {
      if ((event as any).type === 'content_block_delta' && (event as any).delta?.type === 'text_delta') {
        const text = (event as any).delta.text || '';
        if (text) { full += text; onChunk(text); }
      }
    }
    return full;
  }

  async healthCheck(): Promise<boolean> {
    return !!process.env.ANTHROPIC_API_KEY;
  }
}
