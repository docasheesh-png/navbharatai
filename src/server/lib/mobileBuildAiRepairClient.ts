// The ONE real LLM call the mobile-ship repair tiers share.
//
// It lived inside routes/mobileShip.ts first; the compile pre-flight (mobileShipPreflight.ts, run from
// the SETUP route) needs the identical call, and a second copy of "how do we talk to a repair model" is
// exactly the one-fact-two-copies class every autopsy in this feature has been about. So it lives here
// once and both routes import it.
//
// OpenAI-compatible on purpose: Z.ai and Moonshot both speak the Chat Completions shape (same pattern as
// GlmProvider). No retries and a hard timeout — a hung provider must fail its rung and let the chain
// move on, never hold the user's build hostage.

import axios from 'axios';
import type { AiRepairModel } from './mobileBuildAiRepair';

export async function callRepairModel(model: AiRepairModel, system: string, prompt: string): Promise<string> {
  const r = await axios.post(
    `${model.baseURL}/chat/completions`,
    {
      model: model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 16000,
      temperature: 0,
    },
    {
      headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
      timeout: Number(process.env.MOBILE_AUTOFIX_AI_TIMEOUT_MS) || 90_000,
    },
  );
  const content = r.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('empty repair reply');
  return content;
}
