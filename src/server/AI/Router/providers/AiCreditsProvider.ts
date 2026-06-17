import OpenAI from 'openai';
import { AIProvider, AIProviderResponse } from '../ProviderTypes';

// OpenAI-compatible gateway for Indian API reseller aicredit.in.
// Set AICREDITS_API_KEY in Cloud Run; optionally AICREDITS_MODEL to override the default.
export class AiCreditsProvider implements AIProvider {
  name: 'AICREDITS' = 'AICREDITS';
  priority = 1;

  private _client?: OpenAI;
  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({
        apiKey: process.env.AICREDITS_API_KEY || 'missing-key',
        baseURL: 'https://aicredit.in/v1',
        timeout: 90_000,  // 90s — prevents silent hang when aicredit.in is slow
        maxRetries: 0,    // AIRouter handles retries via its own circuit-breaker
      });
    }
    return this._client;
  }

  private get defaultModel(): string {
    return process.env.AICREDITS_MODEL || 'claude-3-5-sonnet-20241022';
  }

  async execute(prompt: string, _schema?: any, modelOverride?: string, systemPrompt?: string): Promise<AIProviderResponse> {
    const startTime = Date.now();
    const model = modelOverride || this.defaultModel;

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
      provider: 'AICREDITS',
      model,
    };
  }

  async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const stream = await this.client.chat.completions.create({
      model: this.defaultModel,
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
    return !!process.env.AICREDITS_API_KEY;
  }
}
