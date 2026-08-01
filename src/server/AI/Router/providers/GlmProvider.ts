import OpenAI from 'openai';
import { AIProvider, AIProviderResponse, readProviderUsage } from '../ProviderTypes';

/**
 * GLM (Z.AI) provider — used as a FREE, fast top-of-chain option for Free Chat.
 *
 * Defaults to `glm-4.7-flash`, which Z.AI serves at $0 in / $0 out (a genuinely
 * free model, not a limited trial). It leads the FREE chain so simple chat turns
 * are answered at zero provider cost; when it fails or is rate-limited (the free
 * tier IS rate-limited), the router falls through to the paid providers
 * (Vertex → Gemini → Grok) exactly as before — so reliability is unchanged.
 *
 * OpenAI-compatible: Z.AI exposes `/api/paas/v4` in the OpenAI Chat Completions
 * shape, so the OpenAI SDK is reused (same pattern as GrokProvider). The model id
 * is env-overridable (`GLM_CHAT_MODEL`) so a renamed free model can be switched
 * without a deploy. The provider self-gates on `GLM_API_KEY` via healthCheck, so
 * it stays completely inert until the key is set.
 */
export class GlmProvider implements AIProvider {
  name: 'GLM' = 'GLM';
  priority = 0; // FREE chain leader — tried before the paid providers.

  private static model(): string {
    return process.env.GLM_CHAT_MODEL || 'glm-4.7-flash';
  }

  /**
   * CHAT-leader timeout (rock-solid hardening, admin 2026-07-11). A chat turn is small — if the free
   * tier hangs, the user must NOT wait a minute before Vertex answers. 20s default (vs the build
   * floor's 60s, which carries much larger prompts); env-tunable without a deploy.
   */
  private static timeoutMs(): number {
    const n = Number(process.env.GLM_CHAT_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 20_000;
  }

  // Lazily constructed: `new OpenAI({ apiKey: '' })` throws, which would crash
  // server boot whenever the GLM key is absent (e.g. CI). Build the client only
  // when actually used (the router skips GLM via healthCheck when no key).
  private _client?: OpenAI;
  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({
        apiKey: process.env.GLM_API_KEY || 'missing-key',
        baseURL: process.env.GLM_BASE_URL || 'https://api.z.ai/api/paas/v4',
        timeout: GlmProvider.timeoutMs(), // fail fast so the router falls through quickly
        maxRetries: 0,
      });
    }
    return this._client;
  }

  async execute(prompt: string, _schema?: any, modelOverride?: string, systemPrompt?: string, images?: string[]): Promise<AIProviderResponse> {
    // The free GLM-flash model is text-only. Defer any image turn to the next
    // (vision-capable) provider instead of sending images it cannot read.
    if (Array.isArray(images) && images.length > 0) {
      throw new Error('GLM-flash is text-only — deferring this vision turn to the next provider');
    }

    const startTime = Date.now();
    const model = modelOverride || GlmProvider.model();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await this.client.chat.completions.create({ model, messages, max_tokens: 8000 });

    // Rock-solid: an HTTP-200 with EMPTY content is NOT an answer (free tiers do this when
    // rate-limited/overloaded). Throw at the provider level so EVERY caller — current router
    // (which also guards) or any future one — falls through instead of showing a blank reply.
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error('GLM returned an empty reply — deferring to the next provider');

    return {
      content,
      latencyMs: Date.now() - startTime,
      provider: 'GLM',
      model,
      usage: readProviderUsage(response.usage),
    };
  }

  async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const stream = await this.client.chat.completions.create({
      model: GlmProvider.model(),
      messages,
      max_tokens: 8000,
      stream: true,
    });
    let full = '';
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) { full += text; onChunk(text); }
    }
    // Rock-solid: a stream that completed without ONE chunk is a silent failure, not a success —
    // returning '' quietly would leave the user staring at nothing. Throw so the router's catch
    // path (cooldown + fallback/honest busy message) takes over.
    if (!full.trim()) throw new Error('GLM stream produced no content — deferring to the next provider');
    return full;
  }

  async healthCheck(): Promise<boolean> {
    return !!process.env.GLM_API_KEY;
  }
}
