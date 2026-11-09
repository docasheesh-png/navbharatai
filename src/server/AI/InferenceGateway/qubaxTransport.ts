import { runApprovedQubaxChat, qubaxConfig, QubaxError } from '../../lib/qubax';
import { getServerDb } from '../../lib/serverDb';
import { evidenceBinding } from './profiles';
import type { DispatchClaim } from './executor';
import { GatewayTextTransportError, type GatewayTextInput, type GatewayTextResponse, type GatewayTextConservativeUsage } from './textTransport';

const completions = new WeakMap<object, { claim: string; receivedAtMs: number }>();
const ceilings = new WeakMap<object, { claim: string; usage: GatewayTextConservativeUsage }>();
export function readGatewayQubaxCompletion(value: unknown, claim: DispatchClaim) {
  if (!value || typeof value !== 'object') return undefined;
  const proof = completions.get(value); return proof?.claim === evidenceBinding(claim) ? { receivedAtMs: proof.receivedAtMs } : undefined;
}
export function readGatewayQubaxConservativeUsage(value: unknown, claim: DispatchClaim) {
  if (!value || typeof value !== 'object') return undefined;
  const proof = ceilings.get(value); return proof?.claim === evidenceBinding(claim) ? proof.usage : undefined;
}
export function gatewayQubaxBody(payload: { systemPrompt?: string; prompt: string; streaming: boolean }, outputTokens: number) {
  return { messages: [...(payload.systemPrompt ? [{ role: 'system', content: payload.systemPrompt }] : []), { role: 'user', content: payload.prompt }], max_tokens: outputTokens, stream: payload.streaming };
}
/** Called only after the common full payload/profile/claim/rate validation.
 * Reuses exact-payload operator approval; a reviewed catalog alone is insufficient.
 * The Gateway already owns the atomic money/quota reservation. Never reserve or
 * settle the legacy FreeChain pool a second time, and never label a ceiling an invoice.
 */
export async function executeGatewayQubax(input: GatewayTextInput, onHttpDispatch: () => void = () => {}): Promise<GatewayTextResponse> {
  const cfg = qubaxConfig(); const t = input.transport; const request = input.request;
  const db = getServerDb(); const ceiling = t.rateCard?.supplierPerHttpRequestCeilingNanoUsd;
  if (!db || t.provider !== 'QUBAX' || input.profile.charging !== 'metered'
    || request.surface !== 'chat' || t.baseURL !== cfg.baseURL || process.env[t.credentialEnv] !== cfg.apiKey
    || !Number.isSafeInteger(ceiling) || !ceiling || !input.claim.binding.budget
    || input.claim.binding.budget.amountNanoUsd < ceiling) throw new QubaxError('QUBAX_CONFIGURATION');
  const started = Date.now(); let outputVisible = false;
  const controller = new AbortController(); const signal = AbortSignal.any([input.signal, controller.signal]);
  const hardAt = Math.min(request.deadlineAtMs, started + request.attemptTimeoutMs, started + t.timeoutMs);
  let timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(request.firstOutputTimeoutMs, hardAt - Date.now())));
  try {
    const result = await runApprovedQubaxChat({ db, uid: request.principalId, requestId: input.claim.binding.physicalAttemptId,
      // Preserve server classification. Health is private too; no keyword downgrade.
      privateTurn: request.privacy.dataClass !== 'public', healthTurn: request.privacy.dataClass === 'health', signal,
      body: gatewayQubaxBody({ prompt: input.prompt, systemPrompt: input.systemPrompt, streaming: !!input.onChunk }, request.capability.kind === 'text' ? request.capability.outputTokens : 0),
      expectedSelection: { modelId: t.model, modelRevision: input.profile.modelRevision, maximumNanoUsd: ceiling },
      reserve: async maximum => maximum <= ceiling ? { releaseUndispatched: async () => {} } : null,
      revalidate: async () => {
        signal.throwIfAborted(); input.assertDispatchPolicy();
        if (!await input.authorizeClaim(input)) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
      },
      beforeHttpDispatch: () => { signal.throwIfAborted(); input.assertDispatchPolicy(); onHttpDispatch(); },
      onChunk: async text => {
        signal.throwIfAborted();
        if (text && input.onChunk) {
          if (!outputVisible) { await input.markOutputVisible(); signal.throwIfAborted(); outputVisible = true; }
          await input.onChunk(text);
        }
        if (text) { clearTimeout(timer); timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(30000, hardAt - Date.now()))); }
      },
    });
    signal.throwIfAborted();
    if (result.kind !== 'response') throw new QubaxError('QUBAX_ADMISSION_FAILED');
    if (result.usage && request.capability.kind === 'text'
      && (result.usage.inputTokens > request.capability.inputTokens || result.usage.outputTokens > request.capability.outputTokens)) throw new QubaxError('QUBAX_INVALID_RESPONSE');
    if (!outputVisible) { await input.markOutputVisible(); signal.throwIfAborted(); outputVisible = true; }
    const response: GatewayTextResponse = Object.freeze({ content: result.content, provider: 'QUBAX', model: result.model,
      latencyMs: Date.now() - started, finishReason: 'stop', outputVisible, completeUsage: !!result.usage,
      ...(result.usage ? { usage: Object.freeze({ ...result.usage }) } : {}) });
    const binding = evidenceBinding(input.claim);
    completions.set(response, { claim: binding, receivedAtMs: Date.now() });
    const u = result.usage;
    if (u && request.capability.kind === 'text' && u.inputTokens <= request.capability.inputTokens && u.outputTokens <= request.capability.outputTokens) {
      ceilings.set(response, { claim: binding, usage: Object.freeze({ binding: input.claim.binding, final: true,
        outcome: { kind: 'completed' as const }, outputVisible, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
        chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: ceiling, rateCardVersion: t.rateCard!.version }) });
    }
    return response;
  } catch (error) {
    if (error instanceof QubaxError) throw new GatewayTextTransportError(input.signal.aborted ? 'ABORTED'
      : controller.signal.aborted ? 'TIMEOUT' : error.status === 401 || error.status === 403 ? 'AUTH'
      : error.status === 429 ? 'RATE_LIMIT' : error.status >= 500 ? 'SERVER'
      : error.code === 'QUBAX_POLICY_BLOCKED' ? 'SAFETY_REFUSAL' : 'NETWORK', error.status);
    throw error;
  } finally { clearTimeout(timer); controller.abort(); }
}
