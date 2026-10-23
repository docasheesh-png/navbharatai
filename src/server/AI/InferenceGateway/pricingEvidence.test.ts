import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evidenceBinding, withoutEvidence } from './profiles';
import type { ProviderProfile, RoutingRequest } from './types';
import type { DispatchBinding } from './executor';
import { realRateFor } from '../../AgentV3/providerRates';
import { maximumCostNanoUsd, usdToNanoUsd } from '../FreeChain/spendCap';
import { executeGatewayText, gatewayTextCredentialBinding, gatewayTextPayloadDigest, type GatewayTextInput, type GatewayTextProvider, type GatewayTextTransportConfig } from './textTransport';
import { createGatewayFreePricingProof, isGatewayFreePricingProof } from './pricingEvidence';
import { chatTurnCost, sumChatTurnCosts } from '../../lib/chatSpend';
import { foldAssistantTurn } from '../../lib/assistantSpendRollup';
const mocks = vi.hoisted(() => ({ response: undefined as unknown, record: vi.fn(), spend: vi.fn() }));
vi.mock('../AIRouterManager', () => ({ AIRouterManager: { getRouter: () => ({ routeRaced: async () => ({ response: mocks.response, telemetry: { success: true } }) }) } }));
vi.mock('./runtime', () => ({ isGatewayRouteSelected: () => true, isGatewayTerminalError: () => false }));
vi.mock('../../lib/AssistantSpendStore', () => ({ assistantSpendStore: { record: mocks.record } }));
vi.mock('../../lib/aiSpendZone', () => ({ recordAiSpend: mocks.spend }));
import { callProfessionalAIWithUsage } from '../../lib/professionalRouting';
const SECRET = 'fake-test-secret-never-retain';
const ENV = 'GATEWAY_TEST_CREDENTIAL';
const ENDPOINTS: Record<GatewayTextProvider, string> = {
  GLM: 'https://api.z.ai/api/paas/v4', GEMINI: 'https://generativelanguage.googleapis.com/v1beta/openai',
  GROQ: 'https://api.groq.com/openai/v1', DEEPSEEK: 'https://api.deepseek.com/v1',
  CLOUDFLARE: 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1',
};
function bind(input: GatewayTextInput): GatewayTextInput {
  const request = { ...input.request, payloadDigest: gatewayTextPayloadDigest({ ...input, streaming: !!input.onChunk }) };
  const p = input.profile; const paid = p.charging === 'metered'; const rate = input.transport.rateCard;
  const binding: DispatchBinding = {
    key: { logicalRequestId: request.logicalRequestId, principalId: request.principalId, tenantId: request.tenantId, payloadDigest: request.payloadDigest },
    physicalAttemptId: request.nextPhysicalAttemptId, snapshotRevision: 'snapshot-1',
    requestBinding: evidenceBinding(withoutEvidence(request)), profileBinding: evidenceBinding(withoutEvidence(p)),
    profileId: p.id, profileVersion: p.version, providerId: p.providerId, modelId: p.modelId, modelRevision: p.modelRevision,
    adapterId: p.adapterId, payer: request.payer, budgetScopeId: request.budgetScopeId,
    quota: [{ ledgerKey: 'requests', amount: 1 }],
    ...(paid ? { priceBinding: 'reviewed-price', budgetAuthorizationBinding: 'reviewed-budget', budget: {
      payer: request.payer, budgetScopeId: request.budgetScopeId, periodId: 'reviewed-day',
      amountNanoUsd: maximumCostNanoUsd(2048, 512, rate!.inputNanoUsdPerMillion, rate!.outputNanoUsdPerMillion), rateCardVersion: rate!.version,
    } } : {}),
  };
  return { ...input, request, claim: { id: 'reservation-1', claimId: 'claim-1', intentBinding: evidenceBinding(binding), binding, queueWaitConsumedAtDispatchMs: 0 } };
}
function fixture(provider: GatewayTextProvider = 'GLM', paid = false): GatewayTextInput {
  const now = Date.now(); const payer = { kind: 'platform' as const, ownerId: 'platform-owner' };
  const quality = { tier: 'standard' as const, gateId: 'gate-1', gateVersion: 'v1' };
  const model = paid ? 'deepseek-flash' : provider === 'GLM' ? 'glm-4.7-flash' : 'reviewed-model';
  const profile: ProviderProfile = {
    id: 'profile-1', version: 'v1', providerId: provider, modelId: model, modelRevision: 'reviewed-revision', adapterId: 'gateway-text-v1',
    status: 'approved', serviceClass: 'production', product: 'inference-api', surfaces: ['chat'], qualityApprovals: [quality], termsApprovals: ['terms-v1'],
    capabilities: [{ kind: 'text', maxContextTokens: 4096, maxInputTokens: 2048, maxOutputTokens: 512, streaming: true, systemPrompt: true }],
    privacy: { dataClasses: ['public'], training: 'none', humanReview: 'none', retentionHours: 0, processingRegions: ['reviewed-region'] },
    credentialOwner: payer, quotaDimensions: [{ scope: { providerId: provider, kind: 'account', id: 'reviewed-account' }, meter: 'requests/day' }],
    charging: paid ? 'metered' : 'verified-free-no-overage', evidenceRef: 'reviewed-profile-evidence',
  };
  const request: RoutingRequest = {
    logicalRequestId: 'request-1', nextPhysicalAttemptId: 'attempt-1', payloadDigest: '', policyRevision: 'policy-v1', termsPolicyId: 'terms-v1',
    budgetScopeId: 'platform-free-fallback', principalId: 'principal-1', tenantId: 'tenant-1', surface: 'chat', quality,
    capability: { kind: 'text', inputTokens: 2048, outputTokens: 512, streaming: false, systemPrompt: false },
    privacy: { dataClass: 'public', policyId: 'privacy-1', allowedProcessingRegions: ['reviewed-region'], maxRetentionHours: 0, allowTraining: false, allowHumanReview: false },
    payer, mode: paid ? 'free-first-authorized-paid' : 'strict-free', createdAtMs: now, deadlineAtMs: now + 60000,
    maxQueueWaitMs: 1000, queueWaitConsumedMs: 0, queueEnteredAtMs: now, firstOutputTimeoutMs: 10000, attemptTimeoutMs: 60000,
    cancellation: { id: 'cancellation-1', cancelled: false }, outputVisible: false, maxPhysicalAttempts: 1, attempts: [], evidenceRef: 'request-evidence',
  };
  const rate = realRateFor('DEEPSEEK', 'deepseek-flash');
  const transport: GatewayTextTransportConfig = { provider, baseURL: ENDPOINTS[provider], model, maxOutputTokens: 512,
    timeoutMs: 60000, streamUsage: true, credentialEnv: ENV, credentialBinding: gatewayTextCredentialBinding(SECRET),
    ...(paid ? { rateCard: { version: 'reviewed-rate-v1', inputNanoUsdPerMillion: usdToNanoUsd(rate.inputPerMTok),
      outputNanoUsdPerMillion: usdToNanoUsd(rate.outputPerMTok), cachedInputNanoUsdPerMillion: usdToNanoUsd(rate.cacheReadPerMTok!),
      verifiedAtMs: now - 1, expiresAtMs: now + 60000 } } : {}) };
  return bind({ profile, request, transport, claim: {} as GatewayTextInput['claim'], prompt: 'Hello', signal: new AbortController().signal,
    authorizeClaim: vi.fn(async () => true), assertDispatchPolicy: vi.fn(() => {}), markOutputVisible: vi.fn(async () => {}), reportCostAnomaly: vi.fn(async () => {}) });
}

beforeEach(() => { vi.stubEnv(ENV, SECRET); vi.clearAllMocks();
 vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Useful answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('authenticated gateway professional cost reporting', () => {
 it.each(['GROQ', 'CLOUDFLARE'] as const)('keeps real %s free-response tokens without invented Sonnet spend', async provider => {
  const input = fixture(provider); const response = await executeGatewayText(input);
  const proof = createGatewayFreePricingProof(response, input.claim);
  expect(proof).toBeDefined();
  mocks.response = { ...response, inferenceGateway: { version: 1, logicalRequestId: input.request.logicalRequestId, accounting: 'separate-ledger' }, gatewayPricingProof: proof };
  const answer = await callProfessionalAIWithUsage('system', 'question', 'free');
  expect(answer.spend.gatewayPricingProof).toBe(proof);
  const record = mocks.record.mock.calls[0][0];
  expect(record.cost).toMatchObject({ measured: true, costBasis: 'verified-free', realUsd: 0, billedInr: 0, inputTokens: 100, outputTokens: 20 });
  expect(foldAssistantTurn(null, '2026-10-23', record)).toMatchObject({ freeTurns: 1, paidTurns: 0, realUsd: 0 });
  const expected = { provider, model: response.model, usage: response.usage, logicalRequestId: input.request.logicalRequestId };
  expect(isGatewayFreePricingProof({ ...proof }, expected)).toBe(false);
  expect(isGatewayFreePricingProof(proof, { ...expected, model: 'other' })).toBe(false);
  expect(isGatewayFreePricingProof(proof, { ...expected, logicalRequestId: 'other' })).toBe(false);
  expect(isGatewayFreePricingProof(proof, { ...expected, usage: { inputTokens: 101, outputTokens: 20 } })).toBe(false);
  expect(createGatewayFreePricingProof({ ...response }, input.claim)).toBeUndefined();
  expect(createGatewayFreePricingProof(response, { ...input.claim, claimId: 'other' })).toBeUndefined();
 });
 it('does not accept a JSON pricing proof or use separate-ledger tokens as invoice spend', async () => {
  mocks.response = { content: 'answer', provider: 'GROQ', model: 'model', latencyMs: 1, usage: { inputTokens: 100, outputTokens: 20 },
   inferenceGateway: { version: 1, logicalRequestId: 'request', accounting: 'separate-ledger' }, gatewayPricingProof: { kind: 'gateway-verified-free' } };
  await callProfessionalAIWithUsage('system', 'question', 'free');
  expect(mocks.record.mock.calls[0][0].cost).toMatchObject({ measured: false, tokensMeasured: true, costBasis: 'unpriced-gateway', realUsd: 0, inputTokens: 100, outputTokens: 20 });
  expect(foldAssistantTurn(null, '2026-10-23', mocks.record.mock.calls[0][0])).toMatchObject({ freeTurns: 0, paidTurns: 0, unmeasuredTurns: 1, unpricedGatewayTurns: 1 });
 });
 it('keeps a paid gateway result unpriced in legacy reporting, with its liability only in the gateway ledger', () => {
  expect(chatTurnCost({ provider: 'DEEPSEEK', model: 'deepseek-flash', inputTokens: 100, outputTokens: 20,
   inferenceGateway: { version: 1, logicalRequestId: 'request', accounting: 'separate-ledger' } }, 85)).toMatchObject({ measured: false, costBasis: 'unpriced-gateway', realUsd: 0, billedInr: 0, inputTokens: 100 });
 });
 it('preserves measured token counts when only unpriced gateway turns are summed', () => {
  const cost = chatTurnCost({ provider: 'DEEPSEEK', model: 'deepseek-flash', inputTokens: 100, outputTokens: 20, inferenceGateway: { version: 1, logicalRequestId: 'r', accounting: 'separate-ledger' } }, 85);
  expect(sumChatTurnCosts([cost, cost], 85)).toMatchObject({ measured: false, costBasis: 'unpriced-gateway', inputTokens: 200, outputTokens: 40, realUsd: 0 });
 });
 it('retains incomplete-cost provenance in mixed free/paid and unpriced sums without changing known bill amounts', () => {
  const unknown = chatTurnCost({ provider: 'DEEPSEEK', model: 'deepseek-flash', inputTokens: 100, outputTokens: 20, inferenceGateway: { version: 1, logicalRequestId: 'r', accounting: 'separate-ledger' } }, 85);
  for (const known of [chatTurnCost({ provider: 'GLM', model: 'glm-4.7-flash', inputTokens: 100, outputTokens: 20 }, 85), chatTurnCost({ provider: 'ANTHROPIC', model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 20 }, 85)]) {
   const sum = sumChatTurnCosts([known, unknown], 85);
   expect(sum).toMatchObject({ measured: true, costIncomplete: true, costBasis: 'unpriced-gateway', realUsd: known.realUsd, billedUsd: known.billedUsd, billedInr: known.billedInr, inputTokens: 200 });
   expect(foldAssistantTurn(null, '2026-10-23', { cost: sum })).toMatchObject({ freeTurns: 0, paidTurns: 0, unmeasuredTurns: 1, unpricedGatewayTurns: 1, realUsd: Math.round(known.realUsd * 1e6) / 1e6 });
  }
 });
 it('preserves existing legacy paid and free tariffs', () => {
  expect(chatTurnCost({ provider: 'ANTHROPIC', model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 20 }, 85).realUsd).toBeGreaterThan(0);
  expect(chatTurnCost({ provider: 'GLM', model: 'glm-4.7-flash', inputTokens: 100, outputTokens: 20 }, 85)).toMatchObject({ measured: true, realUsd: 0 });
 });
});
