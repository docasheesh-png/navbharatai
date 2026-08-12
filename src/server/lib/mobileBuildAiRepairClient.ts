// The ONE real LLM call the mobile-ship repair tiers share.
//
// It lived inside routes/mobileShip.ts first; the compile pre-flight (mobileShipPreflight.ts, run from
// the SETUP route) needs the identical call, and a second copy of "how do we talk to a repair model" is
// exactly the one-fact-two-copies class every autopsy in this feature has been about. So it lives here
// once and both routes import it.
//
// Two wire protocols: GLM (Z.ai) and Kimi (Moonshot) speak the OpenAI Chat Completions shape; Claude
// (the paid tiers, per the Model Routing Policy) speaks the Anthropic Messages API. The rung's `kind`
// selects the protocol. No retries and a hard timeout either way — a hung provider must fail its rung
// and let the chain move on, never hold the user's build hostage.

import axios from 'axios';
import type { AiRepairModel } from './mobileBuildAiRepair';

export async function callRepairModel(model: AiRepairModel, system: string, prompt: string): Promise<string> {
  const timeout = Number(process.env.MOBILE_AUTOFIX_AI_TIMEOUT_MS) || 90_000;

  if (model.kind === 'anthropic') {
    // Anthropic Messages API: system is its own top-level field, and the reply is content[].text.
    const r = await axios.post(
      `${model.baseURL}/messages`,
      {
        model: model.model,
        max_tokens: 16000,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': model.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout,
      },
    );
    const parts = r.data?.content;
    const text = Array.isArray(parts)
      ? parts.map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : '')).join('')
      : '';
    if (!text.trim()) throw new Error('empty repair reply');
    return text;
  }

  // OpenAI-compatible (GLM / Kimi).
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
      timeout,
    },
  );
  const content = r.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('empty repair reply');
  return content;
}
