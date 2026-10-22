import { strictFreeRequired } from '../AI/inferencePolicy';
import { strictFreeText } from '../AI/LiveRegistry/runtime';
import OpenAI from 'openai';
import { parseKeyPool } from '../lib/keyPool';
import { glmThinkingParam } from './providers/glmThinking';
import { WEAK_SCOPE_MODEL, WEAK_SCOPE_TIMEOUT_MS } from './weakBuildAdmission';

let turn = 0;
export async function weakBuildAdmissionAsk(system: string, user: string, signal: AbortSignal) {
  if (strictFreeRequired()) {
    const result = await strictFreeText({ systemPrompt: system, prompt: user, maxOutputTokens: 8, signal });
    return { text: result.content, model: result.model, provider: result.provider, ...(result.usage ? { usage: { ...result.usage, pricingProof: result.pricingProof } } : {}) };
  }
  const keys = parseKeyPool(process.env.GLM_API_KEY);
  if (!keys.length) throw new Error('scope classifier unavailable');
  const client = new OpenAI({ apiKey: keys[turn++ % keys.length], baseURL: process.env.GLM_BASE_URL || 'https://api.z.ai/api/paas/v4', timeout: WEAK_SCOPE_TIMEOUT_MS, maxRetries: 0 });
  const res = await client.chat.completions.create({
    model: WEAK_SCOPE_MODEL,
    temperature: 0,
    max_tokens: 8,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...(glmThinkingParam(WEAK_SCOPE_MODEL, false) as Record<string, unknown>),
  } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal });
  return {
    text: String(res.choices?.[0]?.message?.content ?? ''),
    ...(res.usage ? { usage: { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens } } : {}),
  };
}
