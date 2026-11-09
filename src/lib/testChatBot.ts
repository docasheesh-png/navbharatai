/** Shared, strict boundary for the isolated provider test surface. No provider SDKs here. */
export const TEST_CHAT_PROVIDER_IDS = ['qubax'] as const;
export type TestChatProviderId = typeof TEST_CHAT_PROVIDER_IDS[number];
export const TEST_CHAT_MAX_MESSAGE_CHARS = 8_000;
export const TEST_CHAT_MAX_CONTEXT_CHARS = 32_000;
export const TEST_CHAT_MAX_MESSAGES = 64;
export const TEST_CHAT_MAX_OUTPUT_TOKENS = 1_024;
export const TEST_CHAT_MAX_RESPONSE_CHARS = 32_000;
export const TEST_CHAT_MAX_MODEL_CHARS = 256;
export interface TestChatMessage { role: 'user' | 'assistant'; content: string }
export interface TestChatAction {
  provider: TestChatProviderId;
  requestId: string;
  messages: TestChatMessage[];
  confirmGatewayDisclosure: true;
}
export interface TestChatProviderStatus {
  id: TestChatProviderId;
  label: string;
  configured: boolean;
  enabled: boolean;
  model: string | null;
}
export interface TestChatStatus { providers: TestChatProviderStatus[]; approvalRequired: true; noFallback: true }
export interface TestChatReply {
  requestId: string;
  provider: TestChatProviderId;
  content: string;
  model: string;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
  syntheticMatch?: boolean;
  noFallback: true;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const timestamp = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 8_640_000_000_000_000;
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const safeText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\u0000');
export function readTestChatAction(value: unknown): TestChatAction | null {
  if (!record(value) || !exactKeys(value, ['provider', 'requestId', 'messages', 'confirmGatewayDisclosure'])
    || !TEST_CHAT_PROVIDER_IDS.includes(value.provider as TestChatProviderId)
    || typeof value.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.requestId)
    || value.confirmGatewayDisclosure !== true || !Array.isArray(value.messages)
    || !value.messages.length || value.messages.length > TEST_CHAT_MAX_MESSAGES) return null;
  let total = 0;
  const messages: TestChatMessage[] = [];
  for (const [index, m] of value.messages.entries()) {
    const role = index % 2 ? 'assistant' : 'user';
    if (!record(m) || !exactKeys(m, ['role', 'content']) || m.role !== role
      || !safeText(m.content, m.role === 'assistant' ? TEST_CHAT_MAX_RESPONSE_CHARS : TEST_CHAT_MAX_MESSAGE_CHARS)) return null;
    total += m.content.length;
    if (total > TEST_CHAT_MAX_CONTEXT_CHARS) return null;
    messages.push({ role, content: m.content });
  }
  if (messages.at(-1)?.role !== 'user') return null;
  return { provider: value.provider as TestChatProviderId, requestId: value.requestId, messages, confirmGatewayDisclosure: true };
}
export function isTestChatStatus(v: unknown): v is TestChatStatus {
  return record(v) && v.approvalRequired === true && v.noFallback === true && Array.isArray(v.providers)
    && v.providers.length === TEST_CHAT_PROVIDER_IDS.length
    && v.providers.every((p, i) => record(p) && p.id === TEST_CHAT_PROVIDER_IDS[i] && typeof p.label === 'string'
      && typeof p.configured === 'boolean' && typeof p.enabled === 'boolean' && (p.model === null || safeText(p.model, TEST_CHAT_MAX_MODEL_CHARS)));
}
export function isTestChatReply(v: unknown): v is TestChatReply {
  return record(v) && typeof v.requestId === 'string' && TEST_CHAT_PROVIDER_IDS.includes(v.provider as TestChatProviderId)
    && safeText(v.content, TEST_CHAT_MAX_RESPONSE_CHARS) && safeText(v.model, TEST_CHAT_MAX_MODEL_CHARS) && v.noFallback === true
    && typeof v.latencyMs === 'number' && Number.isFinite(v.latencyMs) && v.latencyMs >= 0
    && (v.syntheticMatch === undefined || typeof v.syntheticMatch === 'boolean')
    && (v.usage === undefined || (record(v.usage) && Number.isSafeInteger(v.usage.inputTokens) && (v.usage.inputTokens as number) >= 0
      && Number.isSafeInteger(v.usage.outputTokens) && (v.usage.outputTokens as number) >= 0));
}
/** Never display an arbitrary provider/server exception, which can contain credentials or prompts. */
export const TEST_CHAT_FAILURE = 'Test response could not be confirmed. No other provider was tried. A dispatched request may still have cost; do not automatically retry.';

export const TEST_CHAT_SYNTHETIC_PROMPT = 'What is 2 + 2? Reply with one number only.';
export const TEST_CHAT_SYNTHETIC_OUTPUT_TOKENS = 16;
export const TEST_CHAT_READINESS_GATES = ['configured', 'enabled', 'catalog', 'quality', 'supplierCeiling', 'payloadApproval', 'budget', 'reviewerTrust', 'dispatchPolicy'] as const;
export type TestChatReadinessGateId = typeof TEST_CHAT_READINESS_GATES[number];
export interface TestChatReadinessGate {
  state: 'pass' | 'blocked' | 'unknown';
  code: string;
  message: string;
  action: string;
}
/** Sanitized, server-derived review metadata. No credential or credential digest is exposed. */
export interface TestChatReviewRequest {
  kind: 'qubax-admin-review-request-v1';
  approvalId: string;
  payloadDigest: string;
  requestId: string;
  model: string;
  modelRevision: string;
  evidenceBinding: string;
  maximumNanoUsd: number;
  expiresAtMs: number;
  body: { messages: TestChatMessage[]; max_tokens: number; stream: false; model: string };
  /** Exact bytes sent as UTF-8; hash this string rather than reserializing with another implementation. */
  wirePayload: string;
}
export interface TestChatReadiness {
  provider: 'qubax';
  requestId: string;
  checkedAtMs: number;
  ready: boolean;
  readOnly: true;
  noProviderCall: true;
  noFallback: true;
  gates: Record<TestChatReadinessGateId, TestChatReadinessGate>;
  model: string | null;
  expiresAtMs: number | null;
  reviewRequest: TestChatReviewRequest | null;
  catalogDigest: string | null;
  lastSafeDiagnostic: string | null;
  /** Neither local budget nor successful inference proves the gateway balance or charge. */
  providerBalance: 'not-checked';
}
export interface TestChatApprovalImport {
  action: TestChatAction;
  attestation: { keyId: string; payload: string; signature: string };
}
export interface TestChatApprovalReceipt {
  imported: true;
  requestId: string;
  expiresAtMs: number;
  noProviderCall: true;
  noFallback: true;
}
export function readTestChatApprovalImport(v: unknown, maxPayloadChars = 16_000): TestChatApprovalImport | null {
  if (!record(v) || !exactKeys(v, ['action', 'attestation'])) return null;
  const action = readTestChatAction(v.action), a = v.attestation;
  if (!action || !record(a) || !exactKeys(a, ['keyId', 'payload', 'signature'])
    || typeof a.keyId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(a.keyId)
    || !safeText(a.payload, maxPayloadChars) || typeof a.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(a.signature)) return null;
  return { action, attestation: { keyId: a.keyId, payload: a.payload, signature: a.signature } };
}
export function isTestChatReadiness(v: unknown): v is TestChatReadiness {
  return record(v) && v.provider === 'qubax' && typeof v.requestId === 'string'
    && timestamp(v.checkedAtMs) && typeof v.ready === 'boolean' && v.readOnly === true
    && v.noProviderCall === true && v.noFallback === true && v.providerBalance === 'not-checked'
    && (v.model === null || safeText(v.model, TEST_CHAT_MAX_MODEL_CHARS)) && (v.expiresAtMs === null || timestamp(v.expiresAtMs))
    && (v.catalogDigest === null || (typeof v.catalogDigest === 'string' && /^[a-f0-9]{64}$/.test(v.catalogDigest)))
    && (v.lastSafeDiagnostic === null || safeText(v.lastSafeDiagnostic, 100)) && record(v.gates)
    && TEST_CHAT_READINESS_GATES.every(id => { const g = (v.gates as Record<string, unknown>)[id];
      return record(g) && ['pass', 'blocked', 'unknown'].includes(g.state as string) && safeText(g.code, 100)
        && safeText(g.message, 600) && typeof g.action === 'string' && g.action.length <= 600;
    }) && (v.reviewRequest === null || (isTestChatReviewRequest(v.reviewRequest) && v.reviewRequest.requestId === v.requestId && v.reviewRequest.model === v.model))
    && (!v.ready || (timestamp(v.expiresAtMs) && v.expiresAtMs > Number(v.checkedAtMs)
      && TEST_CHAT_READINESS_GATES.every(id => ((v.gates as Record<string, TestChatReadinessGate>)[id]).state === 'pass')));
}
function isTestChatReviewRequest(v: unknown): v is TestChatReviewRequest {
  return record(v) && v.kind === 'qubax-admin-review-request-v1'
    && ['approvalId', 'payloadDigest', 'evidenceBinding'].every(k => typeof v[k] === 'string' && /^[a-f0-9]{64}$/.test(v[k] as string))
    && typeof v.requestId === 'string' && safeText(v.model, TEST_CHAT_MAX_MODEL_CHARS) && safeText(v.modelRevision, 2048)
    && Number.isSafeInteger(v.maximumNanoUsd) && (v.maximumNanoUsd as number) > 0 && timestamp(v.expiresAtMs)
    && record(v.body) && exactKeys(v.body, ['messages', 'max_tokens', 'stream', 'model']) && v.body.model === v.model
    && typeof v.wirePayload === 'string' && v.wirePayload.length <= 256_000 && v.wirePayload === JSON.stringify(v.body)
    && v.body.stream === false && Number.isSafeInteger(v.body.max_tokens) && Number(v.body.max_tokens) >= 1 && Number(v.body.max_tokens) <= TEST_CHAT_MAX_OUTPUT_TOKENS
    && !!readTestChatAction({ provider: 'qubax', requestId: v.requestId, messages: v.body.messages, confirmGatewayDisclosure: true });
}
export function isTestChatApprovalReceipt(v: unknown): v is TestChatApprovalReceipt {
  return record(v) && v.imported === true && typeof v.requestId === 'string' && timestamp(v.expiresAtMs)
    && v.noProviderCall === true && v.noFallback === true;
}

export const TEST_CHAT_BALANCE_CODES = ['disabled', 'configuration', 'busy', 'cancelled', 'timeout', 'authentication', 'permission', 'rate-limit', 'provider-error', 'invalid-response', 'unavailable'] as const;
export type TestChatBalanceCode = typeof TEST_CHAT_BALANCE_CODES[number];
export type TestChatBalance = { status: 'available'; currency: 'USD'; balanceMicros: string; checkedAtMs: number }
  | { status: 'unknown'; code: TestChatBalanceCode };
export function isTestChatBalance(v: unknown): v is TestChatBalance {
  return record(v) && ((v.status === 'available' && v.currency === 'USD' && typeof v.balanceMicros === 'string'
    && /^(0|[1-9][0-9]{0,15})$/.test(v.balanceMicros) && Number(v.balanceMicros) <= Number.MAX_SAFE_INTEGER && timestamp(v.checkedAtMs))
    || (v.status === 'unknown' && typeof v.code === 'string' && TEST_CHAT_BALANCE_CODES.includes(v.code as TestChatBalanceCode)));
}

export const TEST_CHAT_FAILURE_CODES = ['disabled', 'configuration', 'storage', 'approval-or-budget', 'invalid', 'unconfirmed', 'catalog', 'approval', 'budget', 'capacity', 'selection', 'capability'] as const;
export const TEST_CHAT_DIAGNOSTIC_CODES = ['budget-configuration', 'qubax-disabled-or-unconfigured', 'qubax-configuration', 'qubax-capability-excluded', 'qubax-capacity',
  'qubax-price-or-quality-unverified', 'qubax-selection-claim-mismatch', 'qubax-data-approval-or-ceiling-unavailable', 'qubax-budget',
  'qubax-auth-401', 'qubax-auth-403', 'qubax-payment-402', 'qubax-rate-429', 'qubax-upstream-5xx', 'qubax-unavailable',
  'QUBAX_CANCELLED', 'QUBAX_INVALID_RESPONSE', 'QUBAX_INCOMPLETE_STREAM', 'QUBAX_POLICY_BLOCKED', 'QUBAX_APPROVAL_REVOKED'] as const;
export const TEST_CHAT_REVIEW_ERROR_CODES = ['invalid', 'trust-unavailable', 'catalog-unavailable', 'review-invalid', 'approval-conflict', 'catalog-conflict', 'storage-unavailable', 'capacity'] as const;
