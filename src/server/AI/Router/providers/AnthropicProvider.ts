import { AIProvider, AIProviderResponse, readProviderUsage } from '../ProviderTypes';
import Anthropic from '@anthropic-ai/sdk';

/** Detect an image's MIME type from its base64 leading bytes (JPEG/PNG/GIF/WebP). */
export function sniffImageMime(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

export class AnthropicProvider implements AIProvider {
  name: 'ANTHROPIC' = 'ANTHROPIC';
  priority = 4;
  /** Set true in the PROFESSIONAL universe so Claude is tried only after the race fails. */
  lastResort = false;

  private client: Anthropic;
  private readonly modelId: string;

  /** When true, enables extended thinking on streaming calls (Claude Opus only). */
  enableThinking = false;
  /** Token budget for extended thinking (default 8k — balanced depth vs latency). */
  thinkingBudget = 8_000;

  // Default kept CURRENT — claude-3-5-sonnet-20241022 is retired and 404s, which silently
  // killed every fallback chain that constructed this provider without an explicit model.
  constructor(modelId = 'claude-sonnet-4-6') {
    this.modelId = modelId;
    console.log("ANTHROPIC_API_KEY check:", !!process.env.ANTHROPIC_API_KEY);
    // Native Anthropic endpoint only — the aicredits proxy has been removed.
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string, images?: string[]): Promise<AIProviderResponse> {
    const startTime = Date.now();
    const model = modelOverride || this.modelId;

    // Build user content: text + optional base64 images (Claude native vision)
    let userContent: Anthropic.ContentBlockParam[] | string;
    if (images && images.length > 0) {
      const parts: Anthropic.ContentBlockParam[] = images.map(b64 => {
        // base64 string may include a data-URL prefix — use its MIME when present, then strip it.
        // (media_type was hardcoded image/png before, so every JPEG/WebP upload was rejected by
        // the API's media-type validation.)
        const declared = /^data:([^;]+);base64,/.exec(b64)?.[1];
        const raw = b64.replace(/^data:[^;]+;base64,/, '');
        const media = declared || sniffImageMime(raw);
        return {
          type: 'image',
          source: { type: 'base64', media_type: media as any, data: raw },
        } as Anthropic.ImageBlockParam;
      });
      parts.push({ type: 'text', text: prompt });
      userContent = parts;
    } else {
      userContent = prompt;
    }

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }];

    const createParams: any = {
      model,
      max_tokens: this.enableThinking ? this.thinkingBudget + 16_000 : 8_000,
      messages,
    };
    if (systemPrompt) createParams.system = systemPrompt;
    if (this.enableThinking) {
      createParams.thinking = { type: 'enabled', budget_tokens: this.thinkingBudget };
    }

    const response = await this.client.messages.create(createParams);

    const textBlock = response.content.find((b: any) => b.type === 'text') as Anthropic.TextBlock | undefined;
    const content = textBlock?.text ?? '';

    return {
      content: content,
      latencyMs: Date.now() - startTime,
      provider: 'ANTHROPIC',
      model,
      usage: readProviderUsage((response as any).usage),
    };
  }

  async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string> {
    const params: any = {
      model: this.modelId,
      max_tokens: this.enableThinking ? this.thinkingBudget + 16_000 : 8_000,
      messages: [{ role: 'user', content: prompt }],
    };
    if (systemPrompt) params.system = systemPrompt;
    if (this.enableThinking) {
      params.thinking = { type: 'enabled', budget_tokens: this.thinkingBudget };
    }
    const stream = this.client.messages.stream(params);
    let full = '';
    for await (const event of stream) {
      if ((event as any).type === 'content_block_delta') {
        const delta = (event as any).delta;
        if (delta?.type === 'text_delta') {
          const text = delta.text || '';
          if (text) { full += text; onChunk(text); }
        }
        // thinking_delta: streamed silently (not shown in chat output)
      }
    }
    return full;
  }

  async healthCheck(): Promise<boolean> {
    return !!process.env.ANTHROPIC_API_KEY;
  }
}
