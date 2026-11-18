/**
 * Owner 2026-11-17: "jis provider ka balance khatam hoga, woh khud hi band ho jayega" + "user ko 100% response
 * mile, jaldi bhi mile". An empty account is recognised the same way by every router, from the real error shapes
 * the providers send, and nothing healthy is mistaken for one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorQuotaEvidence, isAccountBalanceFailure, isAccountQuotaSignal } from './providerAccountQuota';
import { isFatalProviderError, isProviderBalanceError } from '../AgentV3/providerErrorClass';

/** Shaped like the OpenAI SDK's APIError: `status`, `code`, `type`, the SDK's message, and the body under `error`. */
function sdkError(status: number, message: string, body: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`${status} ${message}`), { status, ...body, error: body });
}

const EMPTY_ACCOUNT: Array<[string, unknown]> = [
  // Z.ai/GLM: an empty balance is HTTP 429 with business code 1113 and a Chinese message — the lead rung of every ladder.
  ['GLM 1113 (429, Chinese)', sdkError(429, '余额不足或无可用资源包,请充值。', { code: '1113' })],
  ['GLM 1113 message only', new Error('429 余额不足或无可用资源包,请充值。')],
  // OpenAI: the billing case is in the CODE; the message is the generic quota sentence.
  ['OpenAI insufficient_quota (429)', sdkError(429, 'You exceeded your current quota, please check your plan and billing details.', { code: 'insufficient_quota', type: 'insufficient_quota' })],
  ['OpenAI billing hard limit', sdkError(400, 'Billing hard limit has been reached', { code: 'billing_hard_limit_reached' })],
  ['Moonshot/Kimi exceeded_current_quota_error', sdkError(429, 'Your account is not active, current state: suspended, you may consider to check your account balance', { type: 'exceeded_current_quota_error' })],
  ['DeepSeek 402', sdkError(402, 'Insufficient Balance')],
  ['OpenRouter 402', sdkError(402, 'Insufficient credits. Add more using https://openrouter.ai/settings/credits')],
  ['a bare 402', { status: 402, message: 'Payment Required' }],
  ['Anthropic credit balance (400)', sdkError(400, 'Your credit balance is too low to access the Anthropic API.', { type: 'invalid_request_error' })],
  ['Vertex billing disabled (403)', new Error('This API method requires billing to be enabled. Please enable billing on project #123.')],
];

const NOT_AN_EMPTY_ACCOUNT: Array<[string, unknown]> = [
  // Gemini sends this sentence on an ordinary per-minute limit. Benching a healthy free rung for it would be a false outage.
  ['Gemini per-minute 429', sdkError(429, 'You exceeded your current quota, please check your plan and billing details.', { status: 'RESOURCE_EXHAUSTED', code: 429 })],
  ['plain rate limit', sdkError(429, 'Rate limit reached for requests', { code: 'rate_limit_exceeded' })],
  ['GLM 1302 rate limit', sdkError(429, '当前API请求过多', { code: '1302' })],
  ['GLM 1308 plan usage limit (resets later, not a recharge)', sdkError(429, 'usage limit reached', { code: '1308' })],
  ['context too long', sdkError(400, "This model's maximum context length is 128000 tokens", { code: 'context_length_exceeded' })],
  ['server error', sdkError(503, 'overloaded')],
  ['timeout', new Error('Request timed out')],
  ['empty', undefined],
];

describe('an empty provider account is recognised from what the provider really sends', () => {
  it.each(EMPTY_ACCOUNT)('%s', (_label, error) => {
    expect(isAccountBalanceFailure(error)).toBe(true);
    // The builder (and the shared live-health layer, which reads this predicate) retires the rung instead of retrying it.
    expect(isProviderBalanceError(error)).toBe(true);
    expect(isFatalProviderError(error)).toBe(true);
  });
  it.each(NOT_AN_EMPTY_ACCOUNT)('%s is not', (_label, error) => {
    expect(isAccountBalanceFailure(error)).toBe(false);
    expect(isProviderBalanceError(error)).toBe(false);
  });
  it('GLM numeric codes mean nothing on another provider', () => {
    expect(isAccountBalanceFailure(sdkError(429, 'busy', { code: '1113' }), 'GROQ')).toBe(false);
    expect(isAccountQuotaSignal({ provider: 'GROQ', status: 429, codes: ['1113'] })).toBe(false);
    expect(isAccountQuotaSignal({ provider: 'GLM', status: 429, codes: ['1113'] })).toBe(true);
  });
});

describe('the enum-only signal the Free chain and the gateway use (they never parse message text)', () => {
  it('402 on any provider, the account codes, and GLM quota codes on GLM', () => {
    for (const provider of ['GROQ', 'DEEPINFRA', 'OPENAI', 'CLOUDFLARE', 'OPENROUTER', 'DEEPSEEK', 'CHEAPERINFERENCE', 'GLM']) {
      expect(isAccountQuotaSignal({ provider, status: 402, codes: [] })).toBe(true);
    }
    for (const code of ['insufficient_quota', 'billing_hard_limit_reached', 'insufficient_balance', 'exceeded_current_quota_error', 'quota_exceeded', 'quota_exhausted']) {
      expect(isAccountQuotaSignal({ provider: 'GROQ', status: 429, codes: [code] })).toBe(true);
    }
    for (const code of ['1113', '1308', '1310', '1313']) expect(isAccountQuotaSignal({ provider: 'GLM', status: 429, codes: [code] })).toBe(true);
    expect(isAccountQuotaSignal({ provider: 'GEMINI', status: 429, codes: ['resource_exhausted', '429'] })).toBe(false);
    expect(isAccountQuotaSignal({ provider: 'GROQ', status: 429, codes: ['rate_limit_exceeded'] })).toBe(false);
  });
  it('reads status and codes from an SDK error, nested body included', () => {
    expect(errorQuotaEvidence(sdkError(429, 'x', { code: '1113' }), 'glm')).toEqual({ provider: 'GLM', status: 429, codes: ['1113', '1113'] });
  });
});

/**
 * THE CLASS LOCK. Four routers kept their own copy of this recognition, and the copies drifted (the defect this module
 * fixes). A new private copy — a file outside this module listing the account-quota enums or GLM's balance code —
 * fails here, so the next router added imports the one answer instead of writing a fifth.
 */
describe('no router keeps a private copy of the empty-account recognition', () => {
  const root = join(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path);
    }
  };
  walk(root);
  it('only providerAccountQuota.ts names these codes as a list', () => {
    const copies = files.filter(f => !f.endsWith('providerAccountQuota.ts')).filter(f => {
      const s = readFileSync(f, 'utf8');
      return /['"]billing_hard_limit_reached['"]/.test(s) || /\[\s*['"]1113['"]/.test(s) || /has\(\s*['"]1113['"]/.test(s)
        || /\(\s*provider === '[A-Z]+'[^)]*\)\s*&&\s*status === 402/.test(s);
    }).map(f => f.slice(root.length + 1));
    expect(copies).toEqual([]);
  });
});
