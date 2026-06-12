import OpenAI from 'openai';
import { AIProvider, AIProviderResponse } from '../ProviderTypes';

export class GrokProvider implements AIProvider {
  name: 'GROK' = 'GROK';
  priority = 3; // After Gemini and Vertex, before Anthropic

  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
      baseURL: 'https://api.x.ai/v1',
    });
  }

  async execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string): Promise<AIProviderResponse> {
    const startTime = Date.now();
    const model = modelOverride || 'grok-3-fast';

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await this.client.chat.completions.create({
      model,
      messages,
      max_tokens: 8000,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      latencyMs: Date.now() - startTime,
      provider: 'GROK',
      model,
    };
  }

  async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string> {
    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const stream = await this.client.chat.completions.create({
      model: 'grok-3-fast',
      messages,
      max_tokens: 8000,
      stream: true,
    });
    let full = '';
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) { full += text; onChunk(text); }
    }
    return full;
  }

  async healthCheck(): Promise<boolean> {
    return !!(process.env.GROK_API_KEY || process.env.XAI_API_KEY);
  }
}
