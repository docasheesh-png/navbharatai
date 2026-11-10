/** Shared, strict boundary for the isolated provider test surface. No provider SDKs here. */
export const TEST_CHAT_PROVIDER_IDS = [
  'glm-4.5-flash',
  'glm-4.7-flash',
  'groq',
  'cloudflare-workers-ai',
  'openrouter-verified-free',
  'mitrify',
  'qubax',
  'cheaperinference-beam',
  'deepinfra-llama-3.1-8b-turbo',
  'deepinfra-deepseek-v4-flash',
  'openai-gpt-5-nano',
  'glm-4.7-flashx',
  'gemini-2.5-flash-lite-paid',
  'gemini-2.5-flash-lite-free',
  'deepseek-flash',
  'nvidia-nemotron',
  'modelscope',
  'llm7',
  'bluesminds',
  'requesty',
  'glm-4.6v-flash',
  'gemini-2.5-flash',
  'surplus',
  'router-one',
  'anthropic-claude',
  'kimi',
  'xai-grok',
] as const;
export type TestChatProviderId = typeof TEST_CHAT_PROVIDER_IDS[number];
export const TEST_CHAT_MAX_MESSAGE_CHARS = 8_000;
export const TEST_CHAT_MAX_CONTEXT_CHARS = 32_000;
export const TEST_CHAT_MAX_MESSAGES = 64;
export const TEST_CHAT_MAX_OUTPUT_TOKENS = 1_024;
export const TEST_CHAT_MAX_RESPONSE_CHARS = 32_000;
export const TEST_CHAT_DIAGNOSTIC_CLASSIFICATIONS = [
  'timeout', 'network', 'auth', 'quota', 'rate-limit', 'http', 'empty', 'cancelled', 'unknown',
] as const;
export type TestChatDiagnosticClassification = typeof TEST_CHAT_DIAGNOSTIC_CLASSIFICATIONS[number];
export interface TestChatMessage { role: 'user' | 'assistant'; content: string }
export const TEST_CHAT_MODEL_ID = /^[\w][\w./:-]{0,199}$/;
export function isAllowedTestChatModel(value: string): boolean {
  return TEST_CHAT_MODEL_ID.test(value) && !value.includes('://') && !/^https?:/i.test(value);
}
export interface TestChatAction {
  provider: TestChatProviderId;
  requestId: string;
  messages: TestChatMessage[];
  confirmGatewayDisclosure: true;
  model?: string;
}
export interface TestChatProviderStatus {
  id: TestChatProviderId;
  label: string;
  configured: boolean;
  enabled: boolean;
  model: string | null;
  unavailableReason?: string;
  privacyUrl?: string | null;
  note?: string;
  billed?: boolean;
  internalRouting?: boolean;
  approvalRequired?: boolean;
  ceilingUsd?: string | null;
  selection?: 'performance' | 'backup' | 'none';
  inputUsdPerMillion?: string | null;
  outputUsdPerMillion?: string | null;
  officialInputUsdPerMillion?: string | null;
  officialOutputUsdPerMillion?: string | null;
  discountBps?: number | null;
}
export interface TestChatFeedSummary { fresh: boolean; observedAtMs: number | null; pricedRows: number; officialMatches: number; discountEligible: number; probePassing: number }
export interface TestChatStatus { providers: TestChatProviderStatus[]; approvalRequired: boolean; noFallback: true; feed?: TestChatFeedSummary }
export interface TestChatReply {
  requestId: string;
  provider: TestChatProviderId;
  content: string;
  model: string;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
  noFallback: true;
}
export interface TestChatAttemptDiagnostic {
  model: string | null;
  latencyMs: number;
  classification: TestChatDiagnosticClassification;
  httpStatus: number | null;
  providerCode: string | null;
  providerType: string | null;
  providerRequestId: string | null;
  providerMessage: string | null;
  rawErrorBody: string | null;
}
export interface TestChatDiagnostic {
  provider: TestChatProviderId;
  model: string | null;
  latencyMs: number;
  classification: TestChatDiagnosticClassification;
  httpStatus: number | null;
  providerCode: string | null;
  providerType: string | null;
  providerRequestId: string | null;
  providerMessage: string | null;
  rawErrorBody: string | null;
  attempts?: TestChatAttemptDiagnostic[];
  finalOutcome?: string;
}
export interface TestChatFailure {
  error: string;
  code: string;
  noFallback: true;
  diagnostic?: TestChatDiagnostic;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const safeText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\u0000');
const optionalText = (v: unknown, max: number): boolean => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\u0000');
const optionalHttps = (v: unknown): boolean => v === null || (typeof v === 'string' && /^https:\/\/[A-Za-z0-9.-]+(?:\/[\w._~:/?#[\]@!$&'()*+,;=%-]*)?$/.test(v) && v.length <= 300);
const optionalDecimal = (v: unknown): boolean => v === null || (typeof v === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) && v.length <= 40);
const PROVIDER_STATUS_KEYS = [
  'id', 'label', 'configured', 'enabled', 'model', 'unavailableReason', 'privacyUrl', 'note', 'billed',
  'internalRouting', 'approvalRequired', 'ceilingUsd', 'selection', 'inputUsdPerMillion', 'outputUsdPerMillion',
  'officialInputUsdPerMillion', 'officialOutputUsdPerMillion', 'discountBps',
];
const ATTEMPT_KEYS = ['model', 'latencyMs', 'classification', 'httpStatus', 'providerCode', 'providerType', 'providerRequestId', 'providerMessage', 'rawErrorBody'];
const DIAGNOSTIC_KEYS = [...ATTEMPT_KEYS, 'provider', 'attempts', 'finalOutcome'];
export function readTestChatAction(value: unknown): TestChatAction | null {
  if (!record(value) || !exactKeys(value, ['provider', 'requestId', 'messages', 'confirmGatewayDisclosure', 'model'])
    || (value.model !== undefined && (typeof value.model !== 'string' || !isAllowedTestChatModel(value.model)))
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
  return { provider: value.provider as TestChatProviderId, requestId: value.requestId, messages, confirmGatewayDisclosure: true,
    ...(typeof value.model === 'string' ? { model: value.model } : {}) };
}
function isProviderStatus(p: unknown, expectedId: TestChatProviderId): p is TestChatProviderStatus {
  return record(p) && exactKeys(p, PROVIDER_STATUS_KEYS) && p.id === expectedId && typeof p.label === 'string'
    && typeof p.configured === 'boolean' && typeof p.enabled === 'boolean' && (p.model === null || safeText(p.model, 200))
    && (p.unavailableReason === undefined || optionalText(p.unavailableReason, 400))
    && (p.privacyUrl === undefined || optionalHttps(p.privacyUrl))
    && (p.note === undefined || optionalText(p.note, 400))
    && (p.billed === undefined || typeof p.billed === 'boolean')
    && (p.internalRouting === undefined || typeof p.internalRouting === 'boolean')
    && (p.approvalRequired === undefined || typeof p.approvalRequired === 'boolean')
    && (p.ceilingUsd === undefined || optionalDecimal(p.ceilingUsd))
    && (p.selection === undefined || p.selection === 'performance' || p.selection === 'backup' || p.selection === 'none')
    && (p.inputUsdPerMillion === undefined || optionalDecimal(p.inputUsdPerMillion))
    && (p.outputUsdPerMillion === undefined || optionalDecimal(p.outputUsdPerMillion))
    && (p.officialInputUsdPerMillion === undefined || optionalDecimal(p.officialInputUsdPerMillion))
    && (p.officialOutputUsdPerMillion === undefined || optionalDecimal(p.officialOutputUsdPerMillion))
    && (p.discountBps === undefined || p.discountBps === null || (Number.isInteger(p.discountBps) && (p.discountBps as number) >= 0 && (p.discountBps as number) <= 10_000));
}
function isFeedSummary(v: unknown): v is TestChatFeedSummary {
  return record(v) && typeof v.fresh === 'boolean'
    && (v.observedAtMs === null || (typeof v.observedAtMs === 'number' && Number.isFinite(v.observedAtMs)))
    && Number.isInteger(v.pricedRows) && (v.pricedRows as number) >= 0
    && Number.isInteger(v.officialMatches) && (v.officialMatches as number) >= 0
    && Number.isInteger(v.discountEligible) && (v.discountEligible as number) >= 0
    && Number.isInteger(v.probePassing) && (v.probePassing as number) >= 0;
}
export function isTestChatStatus(v: unknown): v is TestChatStatus {
  return record(v) && typeof v.approvalRequired === 'boolean' && v.noFallback === true && Array.isArray(v.providers)
    && v.providers.length === TEST_CHAT_PROVIDER_IDS.length
    && v.providers.every((p, i) => isProviderStatus(p, TEST_CHAT_PROVIDER_IDS[i]))
    && (v.feed === undefined || isFeedSummary(v.feed));
}
export function isTestChatReply(v: unknown): v is TestChatReply {
  return record(v) && typeof v.requestId === 'string' && TEST_CHAT_PROVIDER_IDS.includes(v.provider as TestChatProviderId)
    && safeText(v.content, TEST_CHAT_MAX_RESPONSE_CHARS) && safeText(v.model, 200) && v.noFallback === true
    && typeof v.latencyMs === 'number' && Number.isFinite(v.latencyMs) && v.latencyMs >= 0
    && (v.usage === undefined || (record(v.usage) && Number.isSafeInteger(v.usage.inputTokens) && (v.usage.inputTokens as number) >= 0
      && Number.isSafeInteger(v.usage.outputTokens) && (v.usage.outputTokens as number) >= 0));
}
function isTestChatAttempt(v: unknown): v is TestChatAttemptDiagnostic {
  return record(v) && exactKeys(v, ATTEMPT_KEYS)
    && (v.model === null || safeText(v.model, 200))
    && typeof v.latencyMs === 'number' && Number.isFinite(v.latencyMs) && v.latencyMs >= 0
    && TEST_CHAT_DIAGNOSTIC_CLASSIFICATIONS.includes(v.classification as TestChatDiagnosticClassification)
    && (v.httpStatus === null || (typeof v.httpStatus === 'number' && Number.isInteger(v.httpStatus) && v.httpStatus >= 100 && v.httpStatus <= 599))
    && (v.providerCode === null || optionalText(v.providerCode, 200))
    && (v.providerType === null || optionalText(v.providerType, 200))
    && (v.providerRequestId === null || optionalText(v.providerRequestId, 200))
    && (v.providerMessage === null || optionalText(v.providerMessage, 1600))
    && (v.rawErrorBody === null || optionalText(v.rawErrorBody, 1600));
}
export function isTestChatDiagnostic(v: unknown): v is TestChatDiagnostic {
  return record(v) && exactKeys(v, DIAGNOSTIC_KEYS)
    && TEST_CHAT_PROVIDER_IDS.includes(v.provider as TestChatProviderId)
    && (v.model === null || safeText(v.model, 200))
    && typeof v.latencyMs === 'number' && Number.isFinite(v.latencyMs) && v.latencyMs >= 0
    && TEST_CHAT_DIAGNOSTIC_CLASSIFICATIONS.includes(v.classification as TestChatDiagnosticClassification)
    && (v.httpStatus === null || (typeof v.httpStatus === 'number' && Number.isInteger(v.httpStatus) && v.httpStatus >= 100 && v.httpStatus <= 599))
    && (v.providerCode === null || optionalText(v.providerCode, 200))
    && (v.providerType === null || optionalText(v.providerType, 200))
    && (v.providerRequestId === null || optionalText(v.providerRequestId, 200))
    && (v.providerMessage === null || optionalText(v.providerMessage, 1600))
    && (v.rawErrorBody === null || optionalText(v.rawErrorBody, 1600))
    && (v.attempts === undefined || (Array.isArray(v.attempts) && v.attempts.length > 0 && v.attempts.length <= 8 && v.attempts.every(isTestChatAttempt)))
    && (v.finalOutcome === undefined || optionalText(v.finalOutcome, 200));
}
function formatAttempt(prefix: string, d: Pick<TestChatAttemptDiagnostic, 'model' | 'classification' | 'httpStatus' | 'providerCode' | 'providerType' | 'providerRequestId' | 'providerMessage' | 'rawErrorBody' | 'latencyMs'>): string[] {
  return [
    `${prefix}Model: ${d.model ?? '(not reported)'}`,
    `${prefix}Classification: ${d.classification}`,
    `${prefix}HTTP status: ${d.httpStatus ?? '(not reported)'}`,
    `${prefix}Provider code: ${d.providerCode ?? '(not reported)'}`,
    `${prefix}Provider type: ${d.providerType ?? '(not reported)'}`,
    `${prefix}Provider request id: ${d.providerRequestId ?? '(not reported)'}`,
    `${prefix}Latency: ${d.latencyMs} ms`,
    `${prefix}Message: ${d.providerMessage ?? '(not reported)'}`,
    `${prefix}Raw body: ${d.rawErrorBody ?? '(not reported)'}`,
  ];
}
export function formatTestChatDiagnostic(d: TestChatDiagnostic): string {
  const lines = [
    `Provider: ${d.provider}`,
    ...(d.finalOutcome ? [`Final outcome: ${d.finalOutcome}`] : []),
    ...formatAttempt('', d),
  ];
  if (d.attempts?.length) {
    d.attempts.forEach((attempt, index) => {
      lines.push(`--- Attempt ${index + 1} ---`);
      lines.push(...formatAttempt('', attempt));
    });
  }
  return lines.join('\n');
}
/** Safe fallback when a reply cannot be confirmed. Admin diagnostics may add a separate redacted payload. */
export const TEST_CHAT_FAILURE = 'Test response could not be confirmed. No other provider was tried. A dispatched request may still have cost; do not automatically retry.';
