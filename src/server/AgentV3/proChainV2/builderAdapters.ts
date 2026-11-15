/**
 * Pro Chain V2 — the Qubax and Mitrify BUILDER rungs.
 *
 * A rung is made by the builder's ordinary OpenAI-protocol rung factory (injected: in production it is
 * `openAiCompatRunners` from routes/agentv3.ts — OpenAiToolRunner + canary fetch + pacer + size gate,
 * i.e. exactly how every GLM/KIMI/Router One rung is made, tool calling and streaming included). This
 * module then decorates each rung with two v2-only duties:
 *
 *   1. ADMIN-ONLY CALL FACTS — status, provider message, code, latency and model of every call, with
 *      every key redacted, so a z@ test build can be autopsied from its report.
 *   2. NO SILENT ₹0 — when the supplier returns no token usage (`usage.measured === false`), the turn's
 *      tokens are ESTIMATED from the characters sent and received (≈4 chars/token) and the build report
 *      says so (`usageEstimated: true`). A delivered paid call is never billed as a confident zero.
 *
 * Injected factory ⇒ this file has no route import and moves into the main engine unchanged.
 */
import type { NamedRunner } from '../providers/MultiProviderTurnRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';
import { PRO_CHAIN_V2_MITRIFY_LABEL, PRO_CHAIN_V2_QUBAX_LABEL } from './policy';
import {
  QUBAX_BUILDER_BASE_URL, ensureQubaxBuilderCatalog, qubaxBuilderApiKey, qubaxBuilderEnabled, qubaxBuilderModels,
} from './qubaxBuilder';
import { mitrifyBuilderApiKey, mitrifyBuilderBaseUrl, mitrifyBuilderEnabled, mitrifyBuilderModels } from './mitrifyBuilder';
import { redactSecrets, supplierErrorFacts } from './redact';

export type RungFactory = (label: string, apiKey: string, baseURL: string, models: string[]) => NamedRunner[];

export interface SupplierCallEvent {
  provider: string;
  model?: string;
  ok: boolean;
  latencyMs: number;
  status?: number;
  code?: string;
  /** Redacted provider message (failures only). Admin-only. */
  message?: string;
  usageEstimated?: boolean;
}

const CHARS_PER_TOKEN = 4;

/**
 * Brand: a supplier's own error text can name itself ("source":"mitrify"). The thrown error may reach a
 * user through the build's error copy, whose scrubber does not know these two names (and must not learn
 * "mitrify" globally — it is also the hosting domain of users' apps). So only the supplier NAME is swapped
 * for its neutral label, in place: status, code, type and every rate-limit/timeout word are untouched, so
 * the chain classifies the error exactly as before. Best-effort; never throws.
 */
export function neutraliseSupplierNames(err: unknown): void {
  try {
    if (!(err instanceof Error) || typeof err.message !== 'string') return;
    const next = err.message.replace(/\bqubax(?:\.ai)?\b/gi, 'ENGINE_QX').replace(/\bmitrify(?:\.com)?\b/gi, 'ENGINE_MF');
    if (next !== err.message) err.message = next;
  } catch { /* a frozen error keeps its text */ }
}

function charsOf(value: unknown): number {
  try { return typeof value === 'string' ? value.length : JSON.stringify(value ?? '').length; } catch { return 0; }
}

/** ≈4 chars/token estimate of one turn, used ONLY when the supplier reported no usage. PURE. */
export function estimateTurnTokens(params: RunTurnParams, result: TurnResult): { inputTokens: number; outputTokens: number } {
  const input = charsOf(params.system ?? '') + charsOf(params.messages) + charsOf(params.tools ?? []);
  const output = charsOf(result.text ?? '') + charsOf(result.toolUses ?? []);
  return {
    inputTokens: Math.max(1, Math.ceil(input / CHARS_PER_TOKEN)),
    outputTokens: Math.max(1, Math.ceil(output / CHARS_PER_TOKEN)),
  };
}

/** Decorate one rung: call facts + labelled usage estimate. The inner runner's behaviour is unchanged. */
export function decorateSupplierRung(
  rung: NamedRunner,
  provider: string,
  secrets: readonly string[],
  onCall?: (e: SupplierCallEvent) => void,
  now: () => number = Date.now,
  /** false for Router One: its usage and receipts belong to its own accounting entry point, untouched. */
  estimateUsage = true,
): NamedRunner {
  const inner: TurnRunner = rung.runner;
  const model = rung.modelId;
  const runner: TurnRunner = {
    ...inner,
    ...(inner.plannedModel !== undefined ? { plannedModel: inner.plannedModel } : {}),
    async runTurn(params: RunTurnParams): Promise<TurnResult> {
      const started = now();
      try {
        const result = await inner.runTurn(params);
        let out = result;
        let usageEstimated = false;
        if (estimateUsage && result.usage?.measured === false) {
          const est = estimateTurnTokens(params, result);
          const { measured: _drop, ...rest } = result.usage;
          out = { ...result, usage: { ...rest, inputTokens: est.inputTokens, outputTokens: est.outputTokens } };
          usageEstimated = true;
        }
        try { onCall?.({ provider, ...(model ? { model } : {}), ok: true, latencyMs: Math.max(0, now() - started), ...(usageEstimated ? { usageEstimated } : {}) }); } catch { /* observation only */ }
        return out;
      } catch (err) {
        try {
          const f = supplierErrorFacts(err);
          onCall?.({
            provider, ...(model ? { model } : {}), ok: false, latencyMs: Math.max(0, now() - started),
            ...(f.status !== undefined ? { status: f.status } : {}), ...(f.code ? { code: redactSecrets(f.code, secrets) } : {}),
            message: redactSecrets(f.message, secrets),
          });
        } catch { /* observation only */ }
        neutraliseSupplierNames(err);
        throw err;
      }
    },
  };
  return { ...rung, runner };
}

/** Qubax builder rungs (empty when not configured). */
export function qubaxBuilderRungs(
  factory: RungFactory,
  env: NodeJS.ProcessEnv = process.env,
  onCall?: (e: SupplierCallEvent) => void,
  fetchImpl?: typeof fetch,
): NamedRunner[] {
  if (!qubaxBuilderEnabled(env)) return [];
  try { ensureQubaxBuilderCatalog(fetchImpl ?? fetch); } catch { /* catalogue is best-effort */ }
  const key = qubaxBuilderApiKey(env);
  const { models } = qubaxBuilderModels(env);
  return factory(PRO_CHAIN_V2_QUBAX_LABEL, key, QUBAX_BUILDER_BASE_URL, models)
    .map((r) => decorateSupplierRung(r, PRO_CHAIN_V2_QUBAX_LABEL, key.split(/[\s,]+/), onCall));
}

/** Mitrify builder rungs (empty when not configured). */
export function mitrifyBuilderRungs(
  factory: RungFactory,
  env: NodeJS.ProcessEnv = process.env,
  onCall?: (e: SupplierCallEvent) => void,
): NamedRunner[] {
  if (!mitrifyBuilderEnabled(env)) return [];
  const key = mitrifyBuilderApiKey(env);
  return factory(PRO_CHAIN_V2_MITRIFY_LABEL, key, mitrifyBuilderBaseUrl(env), mitrifyBuilderModels(env))
    .map((r) => decorateSupplierRung(r, PRO_CHAIN_V2_MITRIFY_LABEL, key.split(/[\s,]+/), onCall));
}

/**
 * Router One rungs, observed only: call facts for the report (the BR2388 masked error is exactly what
 * an autopsy needed), while usage, receipts and accounting stay entirely Router One's own.
 */
export function observeRouterOneRungs(
  rungs: NamedRunner[],
  provider: string,
  secrets: readonly string[],
  onCall?: (e: SupplierCallEvent) => void,
): NamedRunner[] {
  return rungs.map((r) => decorateSupplierRung(r, provider, secrets, onCall, Date.now, false));
}
