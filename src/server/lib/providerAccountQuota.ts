/**
 * ONE answer to "has this provider ACCOUNT run out?" — empty balance, a billing hard limit, or a spent account
 * quota. Every router asks the same question, so it lives here once.
 *
 * 🔴 WHY THIS MODULE EXISTS (owner 2026-11-17: "jis provider ka balance khatam hoga, woh khud hi band ho jayega",
 * and "user ko 100% response mile, jaldi bhi mile"). An empty account must take itself out of every ladder and the
 * next provider must answer at once. That only works if every router RECOGNISES an empty account, and four separate
 * copies of the recognition had drifted:
 *   · the Free Chat chain knew `insufficient_balance` and a 402 from DeepSeek / CheaperInference only. A 402 from any
 *     other rung (OpenRouter, DeepInfra, OpenAI, Groq, Cloudflare, GLM FlashX) became INVALID_REQUEST, and the chain
 *     STOPS on that code: the user got no answer, nothing was cooled down, and the next user hit the same empty
 *     account;
 *   · the gateway's text transport did not know `insufficient_balance` and knew a 402 from DeepSeek only;
 *   · the gateway's vision transport knew GLM's codes only, and only on a 429;
 *   · the builder (and the shared live-health layer, which reads the builder's predicate) matched English phrases
 *     only. GLM — the lead rung of every builder ladder — reports an empty balance as HTTP 429 with code 1113 and a
 *     Chinese message, so it was read as a RATE LIMIT and retried; OpenAI puts `insufficient_quota` in the error code,
 *     not the message, so it was missed too.
 *
 * TWO ENTRY POINTS, because the callers hold different evidence:
 *   · `isAccountQuotaSignal` — status + exact provider enum codes only. The Free chain and the gateway deliberately
 *     never parse provider message text, and this keeps that rule.
 *   · `isAccountBalanceFailure` — any thrown error: status, codes on the error and on its nested `error`, and a
 *     narrow set of phrases. It answers the stricter question "does this account need a RECHARGE?", so a quota that
 *     resets by itself (GLM 1308/1310/1313, a generic `quota_exceeded`) is not in it.
 *
 * ⚠️ NARROW ON PURPOSE. Gemini sends "You exceeded your current quota, please check your plan and billing details"
 * on an ordinary per-minute 429 (status RESOURCE_EXHAUSTED). That sentence is NOT matched here: benching a healthy
 * free rung for a per-minute limit would be a false outage. OpenAI's billing case is caught by its code instead.
 *
 * PURE, dependency-free leaf module: routers and the builder both import it, so it must never import them.
 */

/** Provider enum codes meaning the account will not answer until it is recharged. */
export const BALANCE_CODES: readonly string[] = Object.freeze([
  'insufficient_quota', 'billing_hard_limit_reached', 'insufficient_balance', 'exceeded_current_quota_error',
]);
/** Codes meaning the account's quota is spent; it may reset by itself, but no retry now will succeed. */
export const ACCOUNT_QUOTA_CODES: readonly string[] = Object.freeze([...BALANCE_CODES, 'quota_exceeded', 'quota_exhausted']);
/** Z.ai/GLM business codes: 1113 = balance empty; 1308/1310/1313 = plan usage limit reached (resets later). */
export const GLM_BALANCE_CODES: readonly string[] = Object.freeze(['1113']);
export const GLM_ACCOUNT_QUOTA_CODES: readonly string[] = Object.freeze(['1113', '1308', '1310', '1313']);

export interface AccountQuotaEvidence {
  /** Upper-case provider id where the caller knows it (GLM codes are numeric and only mean this on GLM). */
  provider?: string;
  status?: number;
  /** Exact enum values already lower-cased by the caller: code, type, nested code/type/status. */
  codes: readonly string[];
}

/** Status + exact enums only. HTTP 402 Payment Required means the same thing on every provider. */
export function isAccountQuotaSignal(e: AccountQuotaEvidence): boolean {
  if (e.status === 402) return true;
  const has = (list: readonly string[]) => e.codes.some(c => list.includes(c));
  if (has(ACCOUNT_QUOTA_CODES)) return true;
  return e.provider === 'GLM' && has(GLM_ACCOUNT_QUOTA_CODES);
}

const BALANCE_TEXT = new RegExp([
  'credit balance is too low',
  '\\binsufficient[ _-](?:balance|credits?|funds)\\b',
  '\\binsufficient_quota\\b',
  '\\bbilling_hard_limit_reached\\b',
  '\\bexceeded_current_quota_error\\b',
  '\\bpayment required\\b',
  'requires billing to be enabled',
  // A refusal that asks for a recharge is a balance failure, not a rate limit (failedbr #1322, 2026-11-20): KIMI answered
  // "429 Your credit balance is running low … please recharge immediately", was filed as "1 rate-limit", and stayed the
  // first rung of every build. The same account later said "suspended due to insufficient balance".
  '\\bplease recharge\\b',
  '\\brecharge your account\\b',
  'billing (?:account )?(?:is |has been )?(?:disabled|not enabled)',
  '余额不足',
].join('|'), 'i');

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** The status and enum codes a thrown provider error carries (OpenAI/Anthropic SDK errors, fetch wrappers). */
export function errorQuotaEvidence(error: unknown, provider?: string): AccountQuotaEvidence {
  const outer = record(error);
  const nested = record(outer?.error);
  const rawStatus = outer?.status ?? outer?.statusCode;
  const status = typeof rawStatus === 'number' && Number.isInteger(rawStatus) ? rawStatus : undefined;
  const codes = [outer?.code, outer?.type, nested?.code, nested?.type, nested?.status]
    .flatMap(v => typeof v === 'string' ? [v.toLowerCase()] : typeof v === 'number' && Number.isSafeInteger(v) ? [String(v)] : []);
  return { ...(provider ? { provider: provider.toUpperCase() } : {}), ...(status !== undefined ? { status } : {}), codes };
}

/**
 * Does this failure say the provider ACCOUNT needs a recharge? Reads status, codes and a narrow set of phrases.
 * A provider-less GLM 1113 is still recognised by its code, because no other provider uses that number as a code.
 */
export function isAccountBalanceFailure(error: unknown, provider?: string): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : String(record(error)?.message ?? '');
  if (BALANCE_TEXT.test(message)) return true;
  const e = errorQuotaEvidence(error, provider);
  if (e.status === 402) return true;
  if (e.codes.some(c => BALANCE_CODES.includes(c))) return true;
  return (e.provider === undefined || e.provider === 'GLM') && e.codes.some(c => GLM_BALANCE_CODES.includes(c));
}
