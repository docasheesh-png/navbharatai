import {
  TEST_CHAT_DIAGNOSTIC_CLASSIFICATIONS,
  type TestChatAttemptDiagnostic,
  type TestChatDiagnostic,
  type TestChatDiagnosticClassification,
  type TestChatProviderId,
} from '../../lib/testChatBot';

const MAX_FIELD = 1_500;
const ENV_NAME = /\b[A-Z][A-Z0-9_]{2,}(?:_API_KEY|_API_TOKEN|_TOKEN|_SECRET|_PASSWORD|_PRIVATE_KEY|_CREDENTIAL|_CLIENT_SECRET)\b/g;
const KNOWN_ENV_PREFIX = /\b(?:QUBAX|MITRIFY|FREE_CHAIN|GLM|GROQ|GEMINI|GOOGLE|OPENAI|ANTHROPIC|CLAUDE|KIMI|SURPLUS|ROUTER_ONE|CLOUDFLARE|DEEPINFRA|OPENROUTER|CHEAPERINFERENCE|XAI|GROK|DEEPSEEK|NVIDIA|MODELSCOPE|LLM7|BLUESMINDS|REQUESTY|NEMOTRON)_[A-Z0-9_]*(?:API_KEY|API_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL|CLIENT_SECRET|BASE_URL|URL|ENDPOINT|ENABLED|MODEL|CAP|USD|KEY)\b/g;
const BEARER = /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const ASSIGNMENT = /\b(api[_-]?key|authorization|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi;
const GOOGLE_KEY = /\bAIza[0-9A-Za-z_-]{20,}\b/g;
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const AWS_SECRET = /\b(?:aws[_-]?secret[_-]?access[_-]?key|secretAccessKey|SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{30,}/gi;
const PEM_BLOCK = /-----BEGIN[^-]{0,80}PRIVATE KEY-----[\s\S]*?-----END[^-]{0,80}PRIVATE KEY-----/g;
const NEAR_SECRET = /\b(api[_-]?key|secret(?:[_-]?access[_-]?key)?|access[_-]?token|token|password|credential)\b([\s\S]{0,24}?)([A-Za-z0-9+/=_\-.]{24,})/gi;

function highEntropy(token: string): boolean {
  if (token.length < 24) return false;
  const classes = [/[a-z]/.test(token), /[A-Z]/.test(token), /[0-9]/.test(token), /[+/=_\-.]/.test(token)].filter(Boolean).length;
  return classes >= 2 && new Set(token).size >= Math.min(10, Math.floor(token.length / 3));
}

export function redactTestChatDiagnosticText(text: string, extraSecrets: readonly string[] = []): string {
  let out = typeof text === 'string' ? text : '';
  try {
    for (const secret of extraSecrets) {
      if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('[redacted-secret]');
    }
    out = out.replace(PEM_BLOCK, '[redacted-secret]');
    out = out.replace(GOOGLE_KEY, '[redacted-secret]');
    out = out.replace(AWS_ACCESS_KEY, '[redacted-secret]');
    out = out.replace(AWS_SECRET, 'aws_secret_access_key=[redacted-secret]');
    out = out.replace(/\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]');
    out = out.replace(ENV_NAME, '[redacted-env]');
    out = out.replace(KNOWN_ENV_PREFIX, '[redacted-env]');
    out = out.replace(BEARER, 'Bearer [redacted-secret]');
    out = out.replace(ASSIGNMENT, '$1: [redacted-secret]');
    out = out.replace(NEAR_SECRET, (full, word: string, sep: string, token: string) => highEntropy(token) ? `${word}${sep}[redacted-secret]` : full);
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

type AttemptInput = {
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
};

function buildAttempt(input: AttemptInput, extra: readonly string[]): TestChatAttemptDiagnostic {
  const httpStatus = typeof input.httpStatus === 'number' && Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599
    ? input.httpStatus : null;
  return {
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
  attempts?: readonly AttemptInput[];
  finalOutcome?: string;
}): TestChatDiagnostic {
  const extra = input.extraSecrets ?? [];
  const core = buildAttempt(input, extra);
  const attempts = (input.attempts ?? []).slice(0, 8).map(item => buildAttempt(item, extra));
  const finalOutcome = clip(input.finalOutcome, extra);
  return {
    provider: input.provider,
    ...core,
    ...(attempts.length ? { attempts } : {}),
    ...(finalOutcome ? { finalOutcome } : {}),
  };
}
