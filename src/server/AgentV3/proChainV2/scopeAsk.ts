/**
 * Pro Chain V2 — the Weak scope classifier's last step (Qubax → Mitrify) instead of the GLM classifier,
 * so a v2 build never touches GLM/KIMI ("Surplus → Router One → Qubax → Mitrify . only").
 *
 * Same contract as weakBuildAdmissionAsk: one tiny text call, the caller's signal and deadline. Two v2
 * details:
 *   • the answer is normalised to the one word the parser accepts (a model that says "Complex." still
 *     classifies), and
 *   • usage is NOT returned to the caller — the caller records classifier usage under GLM's label and
 *     model. It is buffered here instead, with the right label and model, for the build ledger to add.
 */
import OpenAI from 'openai';
import { canaryFetch } from '../reliability/canarySpendGuard';
import { PRO_CHAIN_V2_MITRIFY_LABEL, PRO_CHAIN_V2_QUBAX_LABEL } from './policy';
import { QUBAX_BUILDER_BASE_URL, qubaxBuilderApiKey, qubaxBuilderEnabled, qubaxBuilderScopeModel } from './qubaxBuilder';
import { mitrifyBuilderApiKey, mitrifyBuilderBaseUrl, mitrifyBuilderEnabled, mitrifyBuilderModels } from './mitrifyBuilder';
import { redactSecrets, supplierErrorFacts } from './redact';

export interface ScopeUsageRow { provider: string; model: string; usage: { inputTokens: number; outputTokens: number }; estimated: boolean }

type ChatCreate = (body: Record<string, unknown>, opts: { signal: AbortSignal }) => Promise<{ choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }>;
export type ScopeClientFactory = (apiKey: string, baseURL: string) => ChatCreate;

const defaultFactory: ScopeClientFactory = (apiKey, baseURL) => {
  const client = new OpenAI({ apiKey, baseURL, timeout: 10_000, maxRetries: 0, fetch: canaryFetch() });
  return (body, opts) => client.chat.completions.create(body as never, opts) as never;
};

/** The one scope word in a model's answer, or the raw text when none is present. PURE. */
export function normaliseScopeAnswer(raw: string): string {
  const m = String(raw ?? '').toLowerCase().match(/\b(simple|complex|strong)\b/);
  return m ? m[1] : String(raw ?? '');
}

export function proChainV2ScopeAsk(opts: {
  buffer: ScopeUsageRow[];
  env?: NodeJS.ProcessEnv;
  factory?: ScopeClientFactory;
  onFailure?: (provider: string, detail: string) => void;
}): ((system: string, user: string, signal: AbortSignal) => Promise<{ text: string }>) {
  const env = opts.env ?? process.env;
  const factory = opts.factory ?? defaultFactory;
  return async (system, user, signal) => {
    const steps: Array<{ label: string; key: string; base: string; model: string }> = [];
    if (qubaxBuilderEnabled(env)) steps.push({ label: PRO_CHAIN_V2_QUBAX_LABEL, key: qubaxBuilderApiKey(env).split(/[\s,]+/)[0], base: QUBAX_BUILDER_BASE_URL, model: qubaxBuilderScopeModel(env) });
    if (mitrifyBuilderEnabled(env)) steps.push({ label: PRO_CHAIN_V2_MITRIFY_LABEL, key: mitrifyBuilderApiKey(env).split(/[\s,]+/)[0], base: mitrifyBuilderBaseUrl(env), model: mitrifyBuilderModels(env)[0] });
    if (!steps.length) throw new Error('scope classifier unavailable');
    let last: unknown;
    for (const s of steps) {
      if (signal.aborted) break;
      try {
        const res = await factory(s.key, s.base)({
          model: s.model, temperature: 0, max_tokens: 8,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }, { signal });
        const text = String(res.choices?.[0]?.message?.content ?? '');
        const inT = Number(res.usage?.prompt_tokens);
        const outT = Number(res.usage?.completion_tokens);
        const measured = Number.isFinite(inT) || Number.isFinite(outT);
        opts.buffer.push({
          provider: s.label, model: s.model, estimated: !measured,
          usage: measured
            ? { inputTokens: Number.isFinite(inT) ? inT : 0, outputTokens: Number.isFinite(outT) ? outT : 0 }
            : { inputTokens: Math.ceil((system.length + user.length) / 4), outputTokens: Math.max(1, Math.ceil(text.length / 4)) },
        });
        return { text: normaliseScopeAnswer(text) };
      } catch (err) {
        last = err;
        try {
          const f = supplierErrorFacts(err);
          opts.onFailure?.(s.label, redactSecrets(`${f.status ?? ''} ${f.code ?? ''} ${f.message}`.trim(), [s.key]));
        } catch { /* observation only */ }
      }
    }
    throw last instanceof Error ? last : new Error('scope classifier unavailable');
  };
}
