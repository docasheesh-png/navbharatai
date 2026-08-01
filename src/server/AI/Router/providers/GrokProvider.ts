import OpenAI from 'openai';
import { AIProvider, AIProviderResponse, readProviderUsage } from '../ProviderTypes';
import { grokVisionModels } from '../../../lib/visionModels';

export class GrokProvider implements AIProvider {
  name: 'GROK' = 'GROK';
  priority = 3; // After Gemini and Vertex, before Anthropic

  // Lazily constructed: `new OpenAI({ apiKey: '' })` throws, which would crash
  // server boot whenever the Grok/XAI key is absent (e.g. CI). Build the client
  // only when actually used (the router skips GROK via healthCheck when no key).
  private _client?: OpenAI;
  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({
        apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY || 'missing-key',
        baseURL: 'https://api.x.ai/v1',
        timeout: 60_000,  // 60s — fail fast so AIRouter can report an error quickly
        maxRetries: 0,
      });
    }
    return this._client;
  }

  async execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string, images?: string[]): Promise<AIProviderResponse> {
    const startTime = Date.now();
    const hasImages = Array.isArray(images) && images.length > 0;
    // Use a CURRENT vision-capable model when images are supplied (grok-2-vision-1212 is
    // retired and 404s — it silently broke every image read via this provider); fast text otherwise.
    const model = modelOverride || (hasImages ? grokVisionModels()[0] : 'grok-3-fast');

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

    if (hasImages) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [
        { type: 'text', text: prompt },
        ...images!.map(b64 => ({
          type: 'image_url' as const,
          image_url: { url: `data:image/png;base64,${b64}` },
        })),
      ];
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    // Vision calls carry large base64 images and reason over them — give them a
    // longer per-request timeout (overrides the 60s client default) so a slow but
    // valid analysis doesn't spuriously fail. Text calls keep the fast default.
    const response = await this.client.chat.completions.create(
      { model, messages, max_tokens: 8000 },
      hasImages ? { timeout: 120_000 } : undefined,
    );

    return {
      content: response.choices[0]?.message?.content || '',
      latencyMs: Date.now() - startTime,
      provider: 'GROK',
      model,
      usage: readProviderUsage(response.usage),
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
