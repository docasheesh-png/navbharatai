import {
  TEST_CHAT_DIAGNOSTIC_CLASSIFICATIONS,
  type TestChatDiagnostic,
  type TestChatDiagnosticClassification,
  type TestChatProviderId,
} from '../../lib/testChatBot';

const MAX_FIELD = 1_500;
const ENV_NAME = /\b[A-Z][A-Z0-9_]{2,}(?:_API_KEY|_API_TOKEN|_TOKEN|_SECRET|_PASSWORD|_PRIVATE_KEY|_CREDENTIAL|_CLIENT_SECRET)\b/g;
const KNOWN_ENV_PREFIX = /\b(?:QUBAX|MITRIFY|FREE_CHAIN|GLM|GROQ|GEMINI|GOOGLE|OPENAI|ANTHROPIC|CLAUDE|KIMI|SURPLUS|ROUTER_ONE|CLOUDFLARE|DEEPINFRA|OPENROUTER|CHEAPERINFERENCE|XAI|GROK|DEEPSEEK|NVIDIA|MODELSCOPE|LLM7|BLUESMINDS|REQUESTY|NEMOTRON)_[A-Z0-9_]+\b/g;
const BEARER = /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const ASSIGNMENT = /\b(api[_-]?key|authorization|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi;

export function redactTestChatDiagnosticText(text: string, extraSecrets: readonly string[] = []): string {
  let out = typeof text === 'string' ? text : '';
  try {
    for (const secret of extraSecrets) {
      if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('[redacted-secret]');
    }
    out = out.replace(/\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]');
    out = out.replace(ENV_NAME, '[redacted-env]');
    out = out.replace(KNOWN_ENV_PREFIX, '[redacted-env]');
    out = out.replace(BEARER, 'Bearer [redacted-secret]');
    out = out.replace(ASSIGNMENT, '$1: [redacted-secret]');
    out = out.replace(/\u0000/g, '');
    if (out.length > MAX_FIELD) {
      const suffix = '…[truncated]';
      out = `${out.slice(0, Math.max(0, MAX_FIELD - suffix.length))}${suffix}`;
    }
    return out;
  } catch {
    return '[redacted]';
  }
}

export function classifyTestChatFailure(input: {
  code?: string;
  httpStatus?: number | null;
  aborted?: boolean;
  timeout?: boolean;
  empty?: boolean;
}): TestChatDiagnosticClassification {
  if (input.empty) return 'empty';
  if (input.timeout || input.code === 'TIMEOUT' || input.httpStatus === 408 || input.httpStatus === 504) return 'timeout';
  if (input.aborted || input.code === 'ABORTED' || input.code === 'QUBAX_CANCELLED' || input.code === 'MITRIFY_CANCELLED') return 'cancelled';
  const code = (input.code ?? '').toUpperCase();
  if (code.includes('AUTH') || input.httpStatus === 401 || input.httpStatus === 403) return 'auth';
  if (code.includes('QUOTA') || input.httpStatus === 402) return 'quota';
  if (code.includes('RATE') || input.httpStatus === 429) return 'rate-limit';
  if (code.includes('TIMEOUT')) return 'timeout';
  if (code.includes('NETWORK') || code.includes('ECONN') || code.includes('ENOTFOUND')) return 'network';
  if (typeof input.httpStatus === 'number') return 'http';
  if (TEST_CHAT_DIAGNOSTIC_CLASSIFICATIONS.includes(code.toLowerCase() as TestChatDiagnosticClassification)) {
    return code.toLowerCase() as TestChatDiagnosticClassification;
  }
  return 'unknown';
}

function clip(value: unknown, extraSecrets: readonly string[]): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const redacted = redactTestChatDiagnosticText(value, extraSecrets);
  return redacted.trim() ? redacted : null;
}

export function buildTestChatDiagnostic(input: {
  provider: TestChatProviderId;
  model?: string | null;
  latencyMs: number;
  classification?: TestChatDiagnosticClassification;
  httpStatus?: number | null;
  providerCode?: string | null;
  providerType?: string | null;
  providerRequestId?: string | null;
  providerMessage?: string | null;
  rawErrorBody?: string | null;
  aborted?: boolean;
  timeout?: boolean;
  empty?: boolean;
  extraSecrets?: readonly string[];
}): TestChatDiagnostic {
  const extra = input.extraSecrets ?? [];
  const httpStatus = typeof input.httpStatus === 'number' && Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599
    ? input.httpStatus : null;
  return {
    provider: input.provider,
    model: typeof input.model === 'string' && input.model.trim() && input.model.length <= 200 ? input.model : null,
    latencyMs: Number.isFinite(input.latencyMs) && input.latencyMs >= 0 ? input.latencyMs : 0,
    classification: input.classification ?? classifyTestChatFailure({
      code: input.providerCode ?? undefined, httpStatus, aborted: input.aborted, timeout: input.timeout, empty: input.empty,
    }),
    httpStatus,
    providerCode: clip(input.providerCode, extra),
    providerType: clip(input.providerType, extra),
    providerRequestId: clip(input.providerRequestId, extra),
    providerMessage: clip(input.providerMessage, extra),
    rawErrorBody: clip(input.rawErrorBody, extra),
  };
}
