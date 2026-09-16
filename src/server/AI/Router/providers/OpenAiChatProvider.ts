import OpenAI from 'openai';
import { AIProvider, AIProviderResponse, readProviderUsage } from '../ProviderTypes';

/**
 * OpenAI provider for the CHAT router — added 2026-09-15 so GPT Nano can serve the FREE ladder.
 *
 * WHY IT EXISTS. Until today this repo had no OpenAI chat provider at all: `OPENAI_API_KEY` reached
 * exactly two places, neither of them chat (AgentV3's tier ladder, which names no OPENAI rung, and
 * one rung of the legacy `/api/build` fallback chain). So "put GPT Nano in the free chat ladder" was
 * not a config change — this class is the missing piece.
 *
 * 🔴 THE MODEL ID IS THE ONE THING THAT COULD NOT BE VERIFIED FROM HERE, AND IT IS SAID PLAINLY.
 * `OPENAI_CHAT_MODEL` (default `gpt-5-nano`) is the id sent to OpenAI. Nobody in this session could
 * call the account to confirm it exists. A WRONG id fails SAFE — the call 404s, `AIRouter` falls to
 * the next rung (Vertex), and the user gets the same answer they get today — but it would fail
 * SILENTLY, which is the failure mode this repo keeps paying for. So a rejected model logs ONE loud
 * admin line naming the env var to fix, instead of vanishing into a generic provider error.
 *
 * 🔒 PRICING IS CORRECT BY CONSTRUCTION, INCLUDING IF SOMEONE FORGETS TO PIN A MODEL.
 * `realRateFor` matches on the model id first: anything containing `gpt` AND `nano` prices at the
 * Nano line ($0.20/$1.25 → chat cost index 2.85, comfortably under the free ceiling of 11.60). An
 * OpenAI rung registered with NO model falls to the provider label, which prices at the FULL GPT
 * bound (index 39) — and the free-tier ceiling then REFUSES it at registration. That is the safe
 * direction on purpose: an unpinned OpenAI rung cannot quietly reach free chat.
 *
 * TEXT ONLY. Nano is a classification/extraction-class model; the admin's own brief says it is never
 * an app-generation engine, and it does not read images. An image turn is DEFERRED to the next
 * (vision-capable) rung rather than sent to a model that cannot see it — the same thing GlmProvider
 * does for `glm-4.7-flash`, for the same reason. (Free chat's own image/PDF path is `runVisionChain`
 * in `routes/chat.ts`, a different code path entirely, and it is untouched by this provider.)
 *
 * Self-gates on `OPENAI_API_KEY` via healthCheck, so with no key it is completely inert.
 */
export class OpenAiChatProvider implements AIProvider {
  name: 'OPENAI' = 'OPENAI';
  priority = 1; // free ladder: after the ₹0 GLM-flash leader, before the paid Vertex rungs.

  /**
   * The id sent to OpenAI when no rung pinned one.
   *
   * ⚠️ `OPENAI_CHAT_MODEL` also OVERRIDES a pinned id, which is deliberate and is the one exception
   * to "the ladder's literal is the truth": the default id could not be verified against the account
   * from here, so an operator must be able to correct a wrong one WITHOUT a deploy. The cost is that
   * the ladder's own price reasoning is only as good as what is set — so an override that is not a
   * nano-class id says so loudly, because the free-tier ceiling was cleared on the nano price.
   */
  static model(pinned?: string): string {
    const env = (process.env.OPENAI_CHAT_MODEL || '').trim();
    const chosen = env || pinned || 'gpt-5-nano';
    if (env && !/nano/i.test(env) && !OpenAiChatProvider._warnedModel) {
      OpenAiChatProvider._warnedModel = true;
      console.warn(
        `[OPENAI_CHAT] OPENAI_CHAT_MODEL="${env}" is not a nano-class id. The FREE ladder cleared the ` +
        `cost ceiling on the nano price ($0.20/$1.25); a dearer id is billed at the full GPT bound. ` +
        `Set a nano id, or remove this rung from the free ladder.`,
      );
    }
    return chosen;
  }

  private static _warnedModel = false;

  /**
   * A chat turn is small, and the whole point of this rung is that it is FAST. If OpenAI hangs the
   * user must not wait through it before Vertex answers — the same 20s reasoning as the GLM leader.
   */
  private static timeoutMs(): number {
    const n = Number(process.env.OPENAI_CHAT_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 20_000;
  }

  // Lazily constructed: `new OpenAI({ apiKey: '' })` throws, which would crash server boot whenever
  // the key is absent (e.g. CI). Built only when actually used; healthCheck keeps the router away.
  private _client?: OpenAI;
  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || 'missing-key',
        baseURL: process.env.OPENAI_BASE_URL || undefined,
        timeout: OpenAiChatProvider.timeoutMs(),
        maxRetries: 0, // fail fast so the router falls through quickly
      });
    }
    return this._client;
  }

  /** One loud, admin-only line when OpenAI rejects the MODEL — the silent-404 case above. */
  private static explain(err: unknown, model: string): void {
    const status = (err as { status?: number } | null)?.status;
    if (status === 404 || status === 400) {
      console.warn(
        `[OPENAI_CHAT] model "${model}" was rejected (HTTP ${status}) — the free ladder fell through to ` +
        `the next rung. If this repeats, the id is wrong: set OPENAI_CHAT_MODEL to a model this ` +
        `account can actually call.`,
      );
    }
  }

  async execute(prompt: string, _schema?: any, modelOverride?: string, systemPrompt?: string, images?: string[]): Promise<AIProviderResponse> {
    // Text-only — defer an image turn instead of sending pixels to a model that cannot read them.
    if (Array.isArray(images) && images.length > 0) {
      throw new Error('GPT Nano is text-only — deferring this vision turn to the next provider');
    }

    const startTime = Date.now();
    const model = OpenAiChatProvider.model(modelOverride);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await this.client.chat.completions.create({ model, messages, max_tokens: 8000 });
      return {
        content: response.choices[0]?.message?.content || '',
        latencyMs: Date.now() - startTime,
        provider: 'OPENAI',
        model,
        usage: readProviderUsage(response.usage),
      };
    } catch (err) {
      OpenAiChatProvider.explain(err, model);
      throw err;
    }
  }

  async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void, model?: string): Promise<string> {
    // THE MODEL MUST RIDE THE STREAM. Chat streams, so a rung that ignores its pinned model streams
    // on the provider default — the exact bug that made every Vertex rung run gemini-2.5-pro.
    const pinned = OpenAiChatProvider.model(model);
    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    try {
      const stream = await this.client.chat.completions.create({
        model: pinned,
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
    } catch (err) {
      OpenAiChatProvider.explain(err, pinned);
      throw err;
    }
  }

  async healthCheck(): Promise<boolean> {
    return !!(process.env.OPENAI_API_KEY || '').trim();
  }
}
