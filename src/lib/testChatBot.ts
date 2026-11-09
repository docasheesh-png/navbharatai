/** Shared, strict boundary for the isolated provider test surface. No provider SDKs here. */
export const TEST_CHAT_PROVIDER_IDS = ['qubax'] as const;
export type TestChatProviderId = typeof TEST_CHAT_PROVIDER_IDS[number];
export const TEST_CHAT_MAX_MESSAGE_CHARS = 8_000;
export const TEST_CHAT_MAX_CONTEXT_CHARS = 32_000;
export const TEST_CHAT_MAX_MESSAGES = 64;
export const TEST_CHAT_MAX_OUTPUT_TOKENS = 1_024;
export const TEST_CHAT_MAX_RESPONSE_CHARS = 32_000;
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
  noFallback: true;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
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
      && typeof p.configured === 'boolean' && typeof p.enabled === 'boolean' && (p.model === null || safeText(p.model, 200)));
}
export function isTestChatReply(v: unknown): v is TestChatReply {
  return record(v) && typeof v.requestId === 'string' && TEST_CHAT_PROVIDER_IDS.includes(v.provider as TestChatProviderId)
    && safeText(v.content, TEST_CHAT_MAX_RESPONSE_CHARS) && safeText(v.model, 200) && v.noFallback === true
    && typeof v.latencyMs === 'number' && Number.isFinite(v.latencyMs) && v.latencyMs >= 0
    && (v.usage === undefined || (record(v.usage) && Number.isSafeInteger(v.usage.inputTokens) && (v.usage.inputTokens as number) >= 0
      && Number.isSafeInteger(v.usage.outputTokens) && (v.usage.outputTokens as number) >= 0));
}
/** Never display an arbitrary provider/server exception, which can contain credentials or prompts. */
export const TEST_CHAT_FAILURE = 'Test response could not be confirmed. No other provider was tried. A dispatched request may still have cost; do not automatically retry.';
