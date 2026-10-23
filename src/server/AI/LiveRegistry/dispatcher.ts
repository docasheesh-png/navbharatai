import { gatewayRetryAfterUntil } from '../InferenceGateway/retryAfter';
import { assertNoUnclaimedGatewayDispatch } from '../InferenceGateway/dispatchBoundary';
import { issueVerifiedFreeProof, type VerifiedFreeProof } from './proof';
import { randomUUID } from 'node:crypto';
import { codingEvidenceRank, codingQualityScores } from './codingQuality';
import { eligibility } from './eligibility';
import { registryCredentialBinding, retryAfterMs, type FetchLike, type RegistryConfig } from './sync';
import type { LiveModelRecord, ModelHealth, RegistryStore, RoutingAudit } from './types';
export const INFERENCE_URL = 'https://openrouter.ai/api/v1/chat/completions';
export class FreeRoutingError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super('No verified free AI endpoint is currently available. Please try again later.'); }
}
export interface FreeTextRequest {
  prompt: string; systemPrompt?: string; maxOutputTokens?: number; signal?: AbortSignal;
  onChunk?: (text: string) => void | Promise<void>;
  /** Server-only gateway fence. Omission preserves existing registry callers. */
  gateway?: RegistryGatewayHooks;
  /** Server-owned hedge controls; never pass client request bodies here. */
  maxAttempts?: 1;
  excludeModelIds?: Set<string>;
  /** Server-owned quality allowlist for ordinary Free Chat Chain; omission preserves legacy selection. */
  allowedModelIds?: readonly string[];
  preferredModelId?: string;
}
export interface RegistryGatewaySelection {
  readonly modelId: string; readonly endpointTag: string; readonly registryVersion: string;
}
export interface RegistryGatewayHooks extends RegistryGatewaySelection {
  readonly authorizeDispatch: (selected: RegistryGatewaySelection) => Promise<boolean>;
  readonly assertDispatchPolicy: () => void;
  readonly beforeVisibleOutput: () => Promise<void>;
  readonly onCostAnomaly?: () => Promise<void>;
  readonly onPhysicalDispatch?: () => void;
}
const issuedGatewayHooks = new WeakSet<object>();
/** Server-only constructor. Serialized or copied hooks cannot bypass the selected dispatch boundary. */
export function createRegistryGatewayHooks(hooks: RegistryGatewayHooks): RegistryGatewayHooks {
  const issued = Object.freeze({ ...hooks }); issuedGatewayHooks.add(issued); return issued;
}
function typedSafetyRefusal(body: any): boolean {
  const safety = new Set(['content_filter', 'content_policy_violation', 'safety', 'safety_violation', 'safety_refusal', 'prohibited_content', 'blocklist', 'spii', 'recitation', 'sensitive']);
  return [body, body?.error].some(envelope => envelope && (!!envelope.refusal
    || [envelope.code, envelope.type, envelope.status].some(value => typeof value === 'string' && safety.has(value.toLowerCase()))
    || (Array.isArray(envelope.choices) && envelope.choices.some((choice: any) => choice?.message?.refusal || choice?.delta?.refusal
      || (typeof choice?.finish_reason === 'string' && safety.has(choice.finish_reason.toLowerCase()))))));
}
// Only an actual completed gateway-mode dispatch can mint final accounting evidence.
const gatewayUsage = new WeakMap<object, { inputTokens: number; outputTokens: number }>();
export function readRegistryGatewayUsage(result: FreeTextResult) { return gatewayUsage.get(result); }
const gatewayHealth = new WeakMap<object, { kind: 'auth' | 'transient' | 'cooldown-unavailable'; receivedAtMs: number }>();
export function readRegistryGatewayHealth(error: unknown) { return error && typeof error === 'object' ? gatewayHealth.get(error) : undefined; }
const gatewayRejections = new WeakMap<object, { status: 429; receivedAtMs: number; cooldownUntilMs?: number }>();
export function readRegistryGatewayRejection(error: unknown) { return error && typeof error === 'object' ? gatewayRejections.get(error) : undefined; }
export interface FreeToolRequest {
  messages: unknown[]; tools?: unknown[]; maxOutputTokens?: number; signal?: AbortSignal;
}
export interface FreeToolCall { id: string; name: string; arguments: string }
export interface FreeTextResult {
  content: string; toolCalls: FreeToolCall[]; finishReason: 'stop' | 'tool_calls' | 'length'; model: string; provider: 'OPENROUTER'; latencyMs: number;
  selectedMaxOutputTokens?: number;
  usage?: { inputTokens: number; outputTokens: number };
  pricingProof: VerifiedFreeProof;
}
function numeric(v: unknown): number | undefined { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined; }
function cost(v: unknown): string | null { return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? String(v) : typeof v === 'string' && /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) ? v : null; }
/** An error carrying generation/usage cannot certify that no generation happened. */
function errorHasGenerationEnvelope(body: unknown): boolean {
  let value = body;
  for (let depth = 0; depth < 8 && value && typeof value === 'object'; depth++) {
    const row = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(row, 'choices') || Object.prototype.hasOwnProperty.call(row, 'usage')) return true;
    value = row.error;
  }
  // Deeply nested/unrecognized envelopes are not sufficient rejection proof either.
  return !!value && typeof value === 'object';
}
function envelopeHasContradictoryCost(body: unknown): boolean {
  let value = body;
  for (let depth = 0; depth < 8 && value && typeof value === 'object'; depth++) {
    const row = value as Record<string, unknown>;
    if (contradictoryCost(row.usage)) return true;
    value = row.error;
  }
  return false;
}
function contradictoryCost(usage: any): boolean { return !!usage && Object.prototype.hasOwnProperty.call(usage, 'cost') && (cost(usage.cost) === null || positive(cost(usage.cost))); }
function positive(v: string | null): boolean { return v !== null && !/^0+(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(v); }
function safeUsage(raw: any): { inputTokens: number; outputTokens: number } | undefined {
  const input = numeric(raw?.prompt_tokens); const output = numeric(raw?.completion_tokens);
  return input !== undefined && output !== undefined ? { inputTokens: input, outputTokens: output } : undefined;
}
async function boundedResponseText(response: Response, gateway = false): Promise<string> {
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 2000000) throw new Error('Response too large'); chunks.push(next.value); } } finally { const cleanup = reader.cancel().catch(() => {}); if (!gateway) await cleanup; }
  return Buffer.concat(chunks).toString('utf8');
}
function validateToolEnvelope(input: FreeToolRequest): { messages: unknown[]; tools: unknown[] } {
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 2000 || !Array.isArray(input.tools ?? [])) throw new FreeRoutingError('INVALID_TOOL_ENVELOPE', 400);
  const tools = (input.tools ?? []).map((raw: any) => {
    if (raw?.type !== 'function' || !raw.function || typeof raw.function.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.function.name) || !raw.function.parameters || typeof raw.function.parameters !== 'object' || Array.isArray(raw.function.parameters)) throw new FreeRoutingError('UNVERIFIED_SERVER_TOOL', 400);
    return { type: 'function', function: { name: raw.function.name, ...(typeof raw.function.description === 'string' ? { description: raw.function.description } : {}), parameters: raw.function.parameters } };
  });
  if (tools.length > 128 || JSON.stringify(tools).length > 250000) throw new FreeRoutingError('TOOL_ENVELOPE_TOO_LARGE', 400);
  const messages = input.messages.map((raw: any) => {
    if (!['system', 'user', 'assistant', 'tool'].includes(raw?.role) || !(typeof raw.content === 'string' || (raw.role === 'assistant' && raw.content === null))) throw new FreeRoutingError('UNVERIFIED_MESSAGE_MODALITY', 400);
    const message: Record<string, unknown> = { role: raw.role, content: raw.content };
    if (raw.role === 'tool') {
      if (typeof raw.tool_call_id !== 'string') throw new FreeRoutingError('INVALID_TOOL_RESULT', 400);
      message.tool_call_id = raw.tool_call_id;
    }
    if (raw.tool_calls !== undefined) {
      if (raw.role !== 'assistant' || !Array.isArray(raw.tool_calls)) throw new FreeRoutingError('INVALID_TOOL_TRANSCRIPT', 400);
      message.tool_calls = raw.tool_calls.map((call: any) => {
        if (call?.type !== 'function' || typeof call.id !== 'string' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') throw new FreeRoutingError('INVALID_TOOL_TRANSCRIPT', 400);
        return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
      });
    }
    return message;
  });
  return { messages, tools };
}
function score(model: LiveModelRecord, health: ModelHealth | undefined): number {
  const rate = health?.attempts ? health.successes / health.attempts : 0.5;
  // Null latency is unknown, not an impossibly fast endpoint.
  return rate * 1000 - Math.min(100000, health?.latencyMs ?? 30000) / 1000 + Math.min(model.contextWindow, 1000000) / 1000000;
}
export class StrictFreeDispatcher {
  private quarantined = new Set<string>();
  private accountCooldownUntil = 0;
  constructor(private readonly store: RegistryStore, private readonly config: () => RegistryConfig, private readonly fetcher: FetchLike = fetch, private readonly now = Date.now) {}
  async toolTurn(input: FreeToolRequest): Promise<FreeTextResult> {
    const envelope = validateToolEnvelope(input);
    return this.run({ prompt: JSON.stringify(envelope.messages), maxOutputTokens: input.maxOutputTokens ?? 8192, signal: input.signal }, envelope);
  }
  async text(input: FreeTextRequest): Promise<FreeTextResult> { return this.run(input); }
  private async run(input: FreeTextRequest, toolEnvelope?: { messages: unknown[]; tools: unknown[] }): Promise<FreeTextResult> {
    const cfg = this.config();
    if (!cfg.enabled || !cfg.apiKey) throw new FreeRoutingError('FREE_REGISTRY_NOT_CONFIGURED');
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > (toolEnvelope ? 1500000 : 250000) || (input.systemPrompt !== undefined && (typeof input.systemPrompt !== 'string' || input.systemPrompt.length > 250000))) throw new FreeRoutingError('INVALID_FREE_REQUEST', 400);
    const gateway = input.gateway;
    if (gateway && !issuedGatewayHooks.has(gateway)) throw new FreeRoutingError('GATEWAY_AUTHORIZATION_REQUIRED');
    if (!gateway) assertNoUnclaimedGatewayDispatch('registry-inference');
    if (gateway && (input.maxAttempts !== 1 || typeof gateway.authorizeDispatch !== 'function' || typeof gateway.assertDispatchPolicy !== 'function' || typeof gateway.beforeVisibleOutput !== 'function')) throw new FreeRoutingError('GATEWAY_AUTHORIZATION_REQUIRED');
    const max = input.maxOutputTokens ?? 2048;
    if (!Number.isSafeInteger(max) || max < 1 || max > (toolEnvelope ? 65536 : 8192)) throw new FreeRoutingError('INVALID_OUTPUT_LIMIT', 400);
    const requestId = randomUUID(); const tried = new Set<string>();
    for (let attempt = 0; attempt < (input.maxAttempts ?? 3); attempt++) {
      if (input.signal?.aborted) throw new FreeRoutingError('REQUEST_ABORTED', 499);
      // Durable read before EACH attempt, not a long-lived candidate cache. Fail closed on store outage.
      const state = await this.store.routingState().catch(() => { throw new FreeRoutingError('FREE_REGISTRY_UNAVAILABLE'); });
      const now = this.now();
      if ((state.accountCooldownUntil ?? 0) > now || this.accountCooldownUntil > now) throw new FreeRoutingError('FREE_ACCOUNT_COOLDOWN');
      if (!state.manifest || state.manifest.expiresAt <= now) throw new FreeRoutingError('FREE_REGISTRY_STALE');
      // UTF-8 bytes is a conservative bound for byte-tokenizers; keep an additional envelope margin.
      const inputBound = Buffer.byteLength(input.prompt + (input.systemPrompt ?? '') + JSON.stringify(toolEnvelope?.tools ?? []), 'utf8') + 256;
      const outputBudget = (m: LiveModelRecord) => toolEnvelope ? Math.min(max, m.maximumOutputTokens ?? max, m.contextWindow - inputBound) : max;
      if (gateway && (state.manifest.version !== gateway.registryVersion || !state.manifest.accountVerified || state.manifest.accountCredentialBinding !== registryCredentialBinding(cfg.apiKey))) throw new FreeRoutingError('GATEWAY_REGISTRY_MISMATCH');
      const candidates = state.models.filter(m => (!gateway || (m.exactModelId === gateway.modelId && m.endpointTag === gateway.endpointTag && m.registryVersion === gateway.registryVersion && m.accountAvailable)) && (!input.allowedModelIds || input.allowedModelIds.includes(m.exactModelId)) && !tried.has(m.exactModelId) && !input.excludeModelIds?.has(m.exactModelId) && !this.quarantined.has(m.exactModelId) && m.endpointTag
        && eligibility(m, state.controls[m.exactModelId], state.health[m.exactModelId], now).status === 'VERIFIED_FREE'
        && (!toolEnvelope?.tools.length || (m.supportedCapabilities.includes('tools') && m.supportedCapabilities.includes('tool_choice:auto'))) && m.supportedCapabilities.includes('max_tokens') && m.contextWindow >= inputBound + outputBudget(m) && outputBudget(m) >= Math.min(max, 1024) && (m.maximumOutputTokens === null || m.maximumOutputTokens >= outputBudget(m)));
      const quality = codingQualityScores(candidates.map(m => toolEnvelope ? codingEvidenceRank(state.controls[m.exactModelId]?.codingEvidence, m.exactModelId, m.endpointTag, now) : null));
      const qualityById = new Map(candidates.map((m, index) => [m.exactModelId, quality[index]]));
      candidates.sort((a, b) => Number(b.exactModelId === input.preferredModelId) - Number(a.exactModelId === input.preferredModelId) || (qualityById.get(b.exactModelId)! - qualityById.get(a.exactModelId)!) || score(b, state.health[b.exactModelId]) - score(a, state.health[a.exactModelId]) || a.exactModelId.localeCompare(b.exactModelId));
      const model = candidates[0]; if (!model) throw new FreeRoutingError('NO_VERIFIED_FREE_MODEL');
      const selectedMaxOutputTokens = outputBudget(model);
      tried.add(model.exactModelId); input.excludeModelIds?.add(model.exactModelId);
      const admitted: RoutingAudit = { requestId, at: now, modelId: model.exactModelId, registryVersion: state.manifest.version, policy: 'STRICT_FREE', outcome: 'admitted', requestedMaxOutputTokens: max, selectedMaxOutputTokens, attempt, reason: model.verificationBasis, estimatedCost: '0' };
      await this.store.record(admitted); // No external call without a durable admission record.
      // Recheck after asynchronous logging: stale/disabled/newly paid metadata cannot authorize dispatch.
      if (!(await this.store.recheck(model, this.now()))) continue;
      if (model.metadataExpiresAt <= this.now()) continue;
      const controller = new AbortController(); const abort = () => controller.abort();
      input.signal?.addEventListener('abort', abort, { once: true });
      if (input.signal?.aborted) abort();
      const timer = setTimeout(abort, 45000); let delivered = false; let terminal = false; let responseReceived = false; let finalReportedCost: string | null = null; let finalProviderRequestId: string | undefined; let finalReportedModel: string | undefined; const started = this.now(); let rejected429At: number | undefined; let gatewayCooldownUntil: number | null | undefined; let physicalDispatch = false;
      try {
        if (gateway) {
          // The final asynchronous registry read must precede the one-use gateway fence:
          // that fence revalidates quota, evidence and the paid day AFTER its own reads.
          if (!(await this.store.recheck(model, this.now()))) throw new FreeRoutingError('GATEWAY_REGISTRY_CHANGED');
          if (await gateway.authorizeDispatch(Object.freeze({ modelId: model.exactModelId, endpointTag: model.endpointTag!, registryVersion: state.manifest.version })) !== true) throw new FreeRoutingError('GATEWAY_AUTHORIZATION_DENIED');
          // No asynchronous operation may occur between this fence and physical fetch.
          if (model.metadataExpiresAt <= this.now() || state.manifest.expiresAt <= this.now()
            || eligibility(model, state.controls[model.exactModelId], state.health[model.exactModelId], this.now()).status !== 'VERIFIED_FREE') throw new FreeRoutingError('GATEWAY_REGISTRY_CHANGED');
          if (controller.signal.aborted) throw new FreeRoutingError('REQUEST_ABORTED', 499);
          if (!this.config().enabled || this.config().apiKey !== cfg.apiKey) throw new FreeRoutingError('GATEWAY_ACCOUNT_CHANGED');
          gateway.assertDispatchPolicy();
        }
        gateway?.onPhysicalDispatch?.(); physicalDispatch = true;
        const response = await this.fetcher(INFERENCE_URL, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model.exactModelId,
            messages: toolEnvelope?.messages ?? [...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []), { role: 'user', content: input.prompt }],
            ...(toolEnvelope?.tools.length ? { tools: toolEnvelope.tools } : {}),
            max_tokens: selectedMaxOutputTokens, stream: !!input.onChunk,
            provider: { only: [model.endpointTag], allow_fallbacks: false, require_parameters: true, data_collection: 'deny', max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
            plugins: [],
          }),
        });
        if (!response.ok) {
          if (gateway) {
            // Preserve terminal safety outcomes even when the provider sends an HTTP error.
            let body: any;
            try { body = JSON.parse(await boundedResponseText(response, true)); } catch { /* Status still classifies non-JSON errors. */ }
            if (envelopeHasContradictoryCost(body)) { await gateway.onCostAnomaly?.(); throw new FreeRoutingError('FREE_BILLING_ANOMALY'); }
            if (typedSafetyRefusal(body)) throw new FreeRoutingError('SAFETY_REFUSAL');
            if (errorHasGenerationEnvelope(body)) throw new FreeRoutingError('GATEWAY_AMBIGUOUS_ERROR');
          }
          if (gateway && response.status === 429) {
            const receivedAt = this.now(); gatewayCooldownUntil = gatewayRetryAfterUntil(response.headers.get('retry-after'), receivedAt);
            if (gatewayCooldownUntil !== null) rejected429At = receivedAt;
          }
          const error = Object.assign(new Error('Provider request failed'), { status: response.status, retryAfter: response.headers.get('retry-after') }); throw error;
        }
        let content = ''; let toolCalls: FreeToolCall[] = []; let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop'; let usage: any; let providerRequestId: string | undefined; let reportedModel: string | undefined; let explicitFinish = false; let finalUsage = false; let wireDone = false;
        const accept = async (data: any) => {
          // Accounting contradictions take precedence over refusal/schema failures:
          // either result is terminal, but only this path persists unknown spend.
          if (gateway && envelopeHasContradictoryCost(data)) {
            this.quarantined.add(model.exactModelId);
            await gateway.onCostAnomaly?.();
            await this.store.quarantine(model.exactModelId, 'Unexpected provider-reported charge.', this.now()).catch(() => {});
            throw new FreeRoutingError('FREE_BILLING_ANOMALY');
          }
          if (gateway && wireDone) throw new FreeRoutingError('GATEWAY_INCOMPLETE_RESPONSE');
          const choice = data?.choices?.[0];
          if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal || choice?.delta?.refusal) throw new FreeRoutingError('SAFETY_REFUSAL');
          if (['content_filter', 'content_policy_violation', 'safety_violation', 'safety_refusal'].includes(data?.error?.code) || ['content_filter', 'content_policy_violation', 'safety_violation', 'safety_refusal'].includes(data?.error?.type)) throw new FreeRoutingError('SAFETY_REFUSAL');
          if (data?.error) throw Object.assign(new Error('Provider returned an error'), { status: Number(data.error.code) || 502 });
          if (gateway) {
            const message = input.onChunk ? choice?.delta : choice?.message;
            if (!data || typeof data !== 'object' || !Array.isArray(data.choices) || data.choices.length > 1
              || (data.model !== undefined && typeof data.model !== 'string')
              || (choice && (choice.index !== undefined && choice.index !== 0))
              || (choice && (!message || typeof message !== 'object' || Array.isArray(message)))
              || message?.tool_calls !== undefined || message?.function_call !== undefined
              || (message?.content !== undefined && message.content !== null && typeof message.content !== 'string')) throw new FreeRoutingError('GATEWAY_INVALID_RESPONSE');
          }
          if (typeof data?.id === 'string') providerRequestId = data.id.slice(0, 200);
          if (typeof data?.model === 'string') reportedModel = data.model;
          if (gateway && ((reportedModel && reportedModel !== model.exactModelId && reportedModel !== model.canonicalResponseModel) || contradictoryCost(data?.usage))) {
            this.quarantined.add(model.exactModelId);
            await gateway.onCostAnomaly?.();
            await this.store.quarantine(model.exactModelId, 'Unexpected provider-reported charge or model identity.', this.now()).catch(() => {});
            throw new FreeRoutingError('FREE_BILLING_ANOMALY');
          }
          if (data?.usage) { usage = data.usage; finalUsage = explicitFinish || ['stop', 'length'].includes(choice?.finish_reason); }
          const wasFinished = explicitFinish;
          if (data?.choices?.[0]?.finish_reason) {
            terminal = true;
            if (gateway && !['stop', 'length'].includes(data.choices[0].finish_reason)) throw new FreeRoutingError('GATEWAY_INVALID_FINISH');
            explicitFinish = ['stop', 'length'].includes(data.choices[0].finish_reason);
            if (['stop', 'tool_calls', 'length'].includes(data.choices[0].finish_reason)) finishReason = data.choices[0].finish_reason;
          }
          if (toolEnvelope && Array.isArray(data?.choices?.[0]?.message?.tool_calls)) {
            toolCalls = data.choices[0].message.tool_calls.map((call: any) => {
              if (call?.type !== 'function' || typeof call.id !== 'string' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string' || call.function.arguments.length > 500000) throw new Error('Invalid function call response');
              if (!toolEnvelope.tools.some((tool: any) => tool.function.name === call.function.name)) throw new Error('Unknown function requested');
              return { id: call.id, name: call.function.name, arguments: call.function.arguments };
            });
          }
          const text = input.onChunk ? data?.choices?.[0]?.delta?.content : data?.choices?.[0]?.message?.content;
          if (gateway && wasFinished && typeof text === 'string' && text) throw new FreeRoutingError('GATEWAY_INCOMPLETE_RESPONSE');
          if (gateway && typeof text === 'string' && text && !data?.usage) { usage = undefined; finalUsage = false; }
          if (typeof text === 'string') { content += text; if (content.length > 1000000) throw new Error('Response too large'); if (input.onChunk && (!gateway || text.length > 0) && (delivered || text.trim())) { const emitted = delivered ? text : content; if (!delivered && gateway) await gateway.beforeVisibleOutput(); if (gateway && controller.signal.aborted) throw new FreeRoutingError('REQUEST_ABORTED', 499); delivered = true; if (gateway) await input.onChunk(emitted); else input.onChunk(emitted); } }
        };
        if (input.onChunk) {
          if (!response.body) throw new Error('Empty response body');
          const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: !!gateway }); let pending = '';
          try {
            while (true) {
              const item = await reader.read(); if (item.done) break;
              pending += decoder.decode(item.value, { stream: true });
              if (pending.length > 1000000) throw new Error('Stream frame too large');
              let index: number;
              while ((index = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1);
                if (line.startsWith('data:')) { const data = line.slice(5).trim(); if (data === '[DONE]') { terminal = true; wireDone = true; } else await accept(JSON.parse(data)); }
              }
              // A terminal SSE marker completes the gateway protocol even if the socket stays open.
              if (gateway && wireDone) break;
            }
            if (gateway && pending.trim()) throw new FreeRoutingError('GATEWAY_INCOMPLETE_RESPONSE');
          } finally {
            // Cleanup cannot keep an already completed/aborted gateway request alive.
            try { const cleanup = reader.cancel(); if (gateway) void cleanup.catch(() => {}); else await cleanup.catch(() => {}); } catch { /* cleanup only */ }
          }
        } else {
          const body = await boundedResponseText(response, !!gateway); await accept(JSON.parse(body));
        }
        if (gateway && (!explicitFinish || (input.onChunk && !wireDone))) throw new FreeRoutingError('GATEWAY_INCOMPLETE_RESPONSE');
        if (input.onChunk && !terminal) throw new Error('Stream ended before completion');
        const reportedCost = cost(usage?.cost); finalReportedCost = reportedCost; finalProviderRequestId = providerRequestId; finalReportedModel = reportedModel;
        // Accept only the exact outbound ID or canonical alias supplied by the same fresh catalog row.
        if ((gateway ? contradictoryCost(usage) : positive(reportedCost)) || (reportedModel && reportedModel !== model.exactModelId && reportedModel !== model.canonicalResponseModel)) {
          this.quarantined.add(model.exactModelId);
          await gateway?.onCostAnomaly?.();
          await this.store.quarantine(model.exactModelId, 'Unexpected provider-reported charge or model identity.', this.now()).catch(() => {});
          throw new FreeRoutingError('FREE_BILLING_ANOMALY');
        }
        if (!content.trim() && !toolCalls.length) throw new Error('Empty provider response');
        responseReceived = true;
        const latencyMs = this.now() - started; const measured = safeUsage(usage);
        const prior = state.health[model.exactModelId];
        await this.store.updateHealth(model.exactModelId, { cooldownUntil: 0, status: null, lastErrorCode: null, attempts: (prior?.attempts ?? 0) + 1, successes: (prior?.successes ?? 0) + 1, latencyMs }).catch(() => {});
        await this.store.record({ ...admitted, outcome: 'success', latencyMs, ...(reportedModel ? { reportedModel } : {}), ...(providerRequestId ? { providerRequestId } : {}), ...(measured ?? {}), ...(numeric(usage?.prompt_tokens_details?.cached_tokens) === undefined ? {} : { cachedTokens: usage.prompt_tokens_details.cached_tokens }), ...(reportedCost === null ? {} : { reportedCost }) }).catch(() => {});
        if (gateway && !delivered) { await gateway.beforeVisibleOutput(); if (controller.signal.aborted) throw new FreeRoutingError('REQUEST_ABORTED', 499); }
        const result: FreeTextResult = { content, toolCalls, finishReason, selectedMaxOutputTokens, model: model.exactModelId, provider: 'OPENROUTER', latencyMs, ...(measured ? { usage: measured } : {}), pricingProof: issueVerifiedFreeProof({ modelId: model.exactModelId, ...(measured ?? {}), registryVersion: state.manifest.version, verifiedAt: model.pricingVerifiedAt, basis: model.verificationBasis, estimatedInferenceUsd: '0', reportedCost }) };
        if (gateway && finalUsage && measured && Number.isSafeInteger(measured.inputTokens + measured.outputTokens) && (usage.total_tokens === undefined || usage.total_tokens === measured.inputTokens + measured.outputTokens)) gatewayUsage.set(result, Object.freeze({ ...measured }));
        return result;
      } catch (error) {
        const status = Number((error as { status?: number }).status);
        const code = error instanceof FreeRoutingError ? error.code : controller.signal.aborted ? 'TIMEOUT_OR_ABORT' : Number.isFinite(status) ? `HTTP_${status}` : 'PROVIDER_FAILED';
        if (input.signal?.aborted) {
          await this.store.record({ ...admitted, outcome: 'failed', reason: 'REQUEST_CANCELLED', estimatedCost: null, latencyMs: this.now() - started }).catch(() => {});
          throw new FreeRoutingError(delivered ? 'PARTIAL_RESPONSE_INTERRUPTED' : 'REQUEST_ABORTED', 499);
        }
        const prior = state.health[model.exactModelId];
        const cooldown = retryAfterMs((error as { retryAfter?: string }).retryAfter, this.now()) ?? (status === 429 ? 60000 : 30000);
        if ([401, 402, 403].includes(status)) { this.accountCooldownUntil = this.now() + Math.max(cooldown, 300000); await this.store.blockAccount(this.accountCooldownUntil, code).catch(() => {}); }
        await this.store.updateHealth(model.exactModelId, { cooldownUntil: this.now() + cooldown, status: status === 429 ? 'RATE_LIMITED' : status === 402 ? 'QUOTA_EXHAUSTED' : 'UNAVAILABLE', lastErrorCode: code, attempts: (prior?.attempts ?? 0) + 1, successes: prior?.successes ?? 0, latencyMs: null }).catch(() => {});
        await this.store.record({ ...admitted, outcome: 'failed', reason: code, ...(finalReportedModel ? { reportedModel: finalReportedModel } : {}), estimatedCost: null, ...(finalReportedCost === null ? {} : { reportedCost: finalReportedCost }), ...(finalProviderRequestId ? { providerRequestId: finalProviderRequestId } : {}), latencyMs: this.now() - started }).catch(() => {});
        if (gateway || responseReceived || delivered || input.signal?.aborted || error instanceof FreeRoutingError || [400, 401, 402, 403, 413, 422].includes(status)) {
          const failure = new FreeRoutingError(code === 'SAFETY_REFUSAL' ? code : delivered ? 'PARTIAL_RESPONSE_INTERRUPTED' : code, status >= 400 && status < 500 ? status : 503);
          if (gateway && physicalDispatch && (['HTTP_401', 'HTTP_403'].includes(code) || /^HTTP_5\d\d$/.test(code) || code === 'PROVIDER_FAILED' || code === 'TIMEOUT_OR_ABORT')) gatewayHealth.set(failure, Object.freeze({ kind: [401, 403].includes(status) ? 'auth' : 'transient', receivedAtMs: this.now() }));
          if (gateway && physicalDispatch && status === 429 && gatewayCooldownUntil === null) gatewayHealth.set(failure, Object.freeze({ kind: 'cooldown-unavailable', receivedAtMs: this.now() }));
          if (gateway && rejected429At !== undefined && !delivered && code === 'HTTP_429') gatewayRejections.set(failure, Object.freeze({ status: 429, receivedAtMs: rejected429At, ...(typeof gatewayCooldownUntil === 'number' ? { cooldownUntilMs: gatewayCooldownUntil } : {}) }));
          throw failure;
        }
      } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); controller.abort(); }
    }
    throw new FreeRoutingError('ALL_FREE_MODELS_FAILED');
  }
}
