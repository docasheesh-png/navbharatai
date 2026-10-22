import { strictFreeRequired } from '../AI/inferencePolicy';
import { strictFreeText } from '../AI/LiveRegistry/runtime';
// The clarity judge's ONE model call: glm-4.7-flashx, thinking disabled, ≤40 output tokens, no retries.
// Throws when GLM is not configured — the gate then fails open (builds). See clarityGate.ts.
import OpenAI from 'openai';
import { parseKeyPool } from '../lib/keyPool';
import { glmThinkingParam } from './providers/glmThinking';
import { CLARITY_JUDGE_MODEL, CLARITY_JUDGE_TIMEOUT_MS } from './clarityGate';

let turn = 0;
export async function clarityJudgeAsk(system: string, user: string, signal: AbortSignal): Promise<string> {
  if (strictFreeRequired()) {
    const result = await strictFreeText({ systemPrompt: system, prompt: user, maxOutputTokens: 40, signal });
    return result.content;
  }
  const keys = parseKeyPool(process.env.GLM_API_KEY);
  if (keys.length === 0) throw new Error('clarity judge: GLM not configured');
  const client = new OpenAI({ apiKey: keys[turn++ % keys.length], baseURL: process.env.GLM_BASE_URL || 'https://api.z.ai/api/paas/v4', timeout: CLARITY_JUDGE_TIMEOUT_MS, maxRetries: 0 });
  const res = await client.chat.completions.create({
    model: CLARITY_JUDGE_MODEL,
    temperature: 0,
    max_tokens: 40,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...(glmThinkingParam(CLARITY_JUDGE_MODEL, false) as Record<string, unknown>),
  } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal });
  return String(res.choices?.[0]?.message?.content ?? '');
}
