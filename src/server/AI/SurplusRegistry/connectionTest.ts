import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from '../../lib/serverDb';
import { parseEnvFlag } from '../../lib/envFlag';
import { surplusBuyerCostToUsd } from './receiptPolicy';
import type { SurplusConnectionTestStatus } from './types';

/** These identities are lifetime fences, not resettable request IDs or approval records. */
export const SURPLUS_CONNECTION_TEST_ID = 'approved-one-shot-v1';
export const SURPLUS_CONNECTION_TEST_AUTHORITY = 'owner-approved-surplus-test-20261024-usd1-v1';
export const SURPLUS_CONNECTION_TEST_DOCUMENT = `surplus_connection_tests/${SURPLUS_CONNECTION_TEST_ID}`;
export const SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT = 'live_ai_registry/surplus-connection-test-review';
const ENDPOINT = 'https://api.surplusintelligence.ai/min90/v1/chat/completions';
const AUTH_ENDPOINT = 'https://api.surplusintelligence.ai/v1/buyer/me';
// Deliberately fixed, matching surplusClient.ts's verified default; no model/URL overrides.
const MODEL = 'deepseek-v4.1-flash';
const TIMEOUT_MS = 60_000;
const AUTH_TIMEOUT_MS = 10_000;
const AUTOMATIC_FUNDING_EVIDENCE_FRESH_MS = 300_000;
const MAX_RESPONSE_BYTES = 65_536;
const REQUEST = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'Reply with exactly OK and nothing else.' }],
  max_tokens: 32, stream: false, si_route: { objective: 'price' } });

export type { SurplusConnectionTestStatus } from './types';
/**
 * Server-internal, independently verified evidence. No route creates or edits this record.
 * A balance, token estimate or alert is NOT a configured provider hard-stop budget.
 * Do not seed this schema with "approved" values: absent genuine evidence, leave it absent.
 */
export interface SurplusConnectionTestReview {
  schemaVersion: 1;
  authorizationId: typeof SURPLUS_CONNECTION_TEST_AUTHORITY;
  testId: typeof SURPLUS_CONNECTION_TEST_ID;
  revision: number;
  accountId: string;
  /** Normalized provider identity/membership, reviewed against the same source artifact. */
  credentialBinding: { keyId: string; accountId: string; workspaceId: string | null; memberId: string | null };
  credentialSha256: string;
  credentialState: 'active';
  accountState: 'active';
  reviewMethod: 'independent-provider-account-evidence';
  reviewedBy: string;
  reviewedAt: number;
  expiresAt: number;
  source: { url: string; artifactSha256: string; observedAt: number };
  /** Actual account funding setting: an inference budget does not cap a separate wallet recharge. */
  automaticFunding: { accountId: string; enabled: false; observedAt: number; verifiedUntil: number; evidenceSha256: string };
  /**
   * Normalized current provider settings, not the wire API's field names. Monthly budgets are
   * documented as limit_month_micro. Ordinary admission/settlement controls, not a zero-risk guarantee.
   */
  hardStop: {
    kind: 'reviewed-provider-spend-budget';
    currency: 'USD';
    scope: 'account' | 'workspace' | 'member' | 'key';
    scopeId: string;
    configuredLimitUsd: string;
    reportedSpendUsd: string;
    remainingBudgetUsd: string;
    period: 'month';
    resetsAt: number;
    accountId: string;
    credentialSha256: string;
    testId: typeof SURPLUS_CONNECTION_TEST_ID;
    active: true;
    paused: false;
    hard_stop: true;
    verifiedAt: number;
    verifiedUntil: number;
    evidenceSha256: string;
  };
}
type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
/** Test seams are server dependencies, never HTTP request parameters. */
export interface SurplusConnectionTestDependencies {
  env?: NodeJS.ProcessEnv;
  db?: Database | null;
  fetcher?: typeof fetch;
  now?: () => number;
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
function canonicalMicro(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.endsWith('0')) return null;
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
function configuration(env: NodeJS.ProcessEnv) {
  const key = env.SURPLUS_API_KEY?.trim();
  const environmentConfigured = typeof window === 'undefined' && text(env.K_SERVICE) && !!key
    && /^inf_[A-Za-z0-9_-]{1,500}$/.test(key) && !key.startsWith('inf_admin_');
  return { environmentConfigured, productionFlagsOff: parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) === false
    && parseEnvFlag(env.SURPLUS_REGISTRY_ENABLED) === false };
}
function result(status: SurplusConnectionTestStatus['status'], env: NodeJS.ProcessEnv,
  fields: Pick<SurplusConnectionTestStatus, 'latencyMs' | 'actualCostUsd' | 'expectedResponse'> = { latencyMs: null, actualCostUsd: null, expectedResponse: 'not_checked' }): SurplusConnectionTestStatus {
  return { status, ...configuration(env), ...fields };
}
function officialSource(value: unknown): boolean {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['surplusintelligence.ai', 'www.surplusintelligence.ai', 'api.surplusintelligence.ai'].includes(url.hostname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch { return false; }
}
function validReview(value: unknown, credentialSha256: string, now: number): value is SurplusConnectionTestReview {
  if (!record(value) || !time(now) || value.schemaVersion !== 1 || value.authorizationId !== SURPLUS_CONNECTION_TEST_AUTHORITY
      || value.testId !== SURPLUS_CONNECTION_TEST_ID || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
      || !text(value.accountId) || value.credentialSha256 !== credentialSha256 || !hash(value.credentialSha256)
      || value.credentialState !== 'active' || value.accountState !== 'active'
      || value.reviewMethod !== 'independent-provider-account-evidence' || !text(value.reviewedBy)
      || !time(value.reviewedAt) || value.reviewedAt > now || !time(value.expiresAt) || value.expiresAt <= now + TIMEOUT_MS) return false;
  const source = value.source, stop = value.hardStop, binding = value.credentialBinding, funding = value.automaticFunding;
  if (!record(source) || !officialSource(source.url) || !hash(source.artifactSha256) || !time(source.observedAt)
      || source.observedAt > value.reviewedAt || !record(stop) || !record(binding) || !text(binding.keyId)
      || binding.accountId !== value.accountId || !(binding.workspaceId === null || text(binding.workspaceId))
      || !(binding.memberId === null || text(binding.memberId))) return false;
  // A valid inference hard stop is not permission for a separate automatic funding charge.
  if (!record(funding) || funding.accountId !== value.accountId || funding.enabled !== false
      || !time(funding.observedAt) || funding.observedAt < source.observedAt || funding.observedAt > value.reviewedAt
      || funding.observedAt < now - AUTOMATIC_FUNDING_EVIDENCE_FRESH_MS
      || !time(funding.verifiedUntil) || funding.verifiedUntil <= now + TIMEOUT_MS || funding.verifiedUntil < value.expiresAt
      || funding.evidenceSha256 !== source.artifactSha256) return false;
  const limit = canonicalMicro(stop.configuredLimitUsd), spent = canonicalMicro(stop.reportedSpendUsd), remaining = canonicalMicro(stop.remainingBudgetUsd);
  const periodIsCurrent = stop.period === 'month' && time(stop.resetsAt) && stop.resetsAt > now + TIMEOUT_MS && stop.resetsAt >= value.expiresAt;
  const scopeId = stop.scope === 'key' ? binding.keyId : stop.scope === 'workspace' ? binding.workspaceId
    : stop.scope === 'member' ? binding.memberId : stop.scope === 'account' ? binding.accountId : null;
  return stop.kind === 'reviewed-provider-spend-budget' && stop.currency === 'USD'
    && limit !== null && spent !== null && remaining !== null && remaining > 0n && remaining <= 1_000_000n && limit - spent === remaining
    && text(scopeId) && stop.scopeId === scopeId && stop.accountId === value.accountId
    && stop.credentialSha256 === credentialSha256 && stop.testId === SURPLUS_CONNECTION_TEST_ID
    && stop.active === true && stop.paused === false && stop.hard_stop === true && periodIsCurrent
    && time(stop.verifiedAt) && stop.verifiedAt >= source.observedAt && stop.verifiedAt <= value.reviewedAt
    && time(stop.verifiedUntil) && stop.verifiedUntil > now + TIMEOUT_MS && stop.verifiedUntil >= value.expiresAt
    && stop.evidenceSha256 === source.artifactSha256;
}
/** Malformed/partial persisted records are consumed fences, never fresh dispatch authority. */
function projectAttempt(value: unknown, env: NodeJS.ProcessEnv): SurplusConnectionTestStatus {
  const held = result('unknown_liability_hold', env);
  if (!record(value) || value.authorizationId !== SURPLUS_CONNECTION_TEST_AUTHORITY || value.testId !== SURPLUS_CONNECTION_TEST_ID
      || value.attempts !== 1 || !record(value.result)) return held;
  const raw = value.result;
  const latencyMs = time(raw.latencyMs) ? raw.latencyMs : null;
  const actualCostUsd = canonicalMicro(raw.actualCostUsd) !== null ? raw.actualCostUsd as string : null;
  const expectedResponse = raw.expectedResponse === 'matched' || raw.expectedResponse === 'mismatched' ? raw.expectedResponse : 'not_checked';
  const fields = { latencyMs, actualCostUsd, expectedResponse } as const;
  if (value.state === 'unknown_liability_hold') return result('unknown_liability_hold', env, fields);
  if (value.state !== 'reported' || latencyMs === null || actualCostUsd === null) return held;
  const reviewedLimit = canonicalMicro(value.remainingBudgetUsd);
  if (reviewedLimit === null || reviewedLimit <= 0n || reviewedLimit > 1_000_000n) return held;
  if (raw.status === 'budget_exceeded' && canonicalMicro(actualCostUsd)! > reviewedLimit) return result('budget_exceeded', env, fields);
  if (canonicalMicro(actualCostUsd)! > reviewedLimit || !['passed', 'failed'].includes(String(raw.status))
      || raw.status === 'passed' && expectedResponse !== 'matched') return held;
  return result(raw.status as 'passed' | 'failed', env, fields);
}
function database(deps: SurplusConnectionTestDependencies): Database | null { return deps.db === undefined ? getServerDb() : deps.db; }

/** Cached status only: never contacts the provider or rewrites/rearms an attempt. */
export async function getSurplusConnectionTestStatus(deps: SurplusConnectionTestDependencies = {}): Promise<SurplusConnectionTestStatus> {
  const env = deps.env ?? process.env;
  try {
    const db = database(deps);
    if (!db) return result('unavailable', env);
    const existing = await db.doc(SURPLUS_CONNECTION_TEST_DOCUMENT).get();
    if (existing.exists) return projectAttempt(existing.data(), env);
    const config = configuration(env);
    if (!config.environmentConfigured || !config.productionFlagsOff) return result('blocked_configuration', env);
    const review = (await db.doc(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT).get()).data();
    return result(validReview(review, digest(env.SURPLUS_API_KEY!.trim()), (deps.now ?? Date.now)()) ? 'ready' : 'blocked_budget_review', env);
  } catch { return result('unavailable', env); }
}

/** Bounded JSON that retains exact numeric lexemes and rejects duplicate keys at every depth. */
function parseExactJson(source: string): unknown {
  let i = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(source[i] ?? 'x')) i++; };
  const invalid = (): never => { throw new Error('Invalid provider response'); };
  function string(): string {
    const start = i++;
    while (i < source.length) {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i++] === '"') return JSON.parse(source.slice(start, i)) as string;
    }
    return invalid();
  }
  function value(depth: number): unknown {
    if (depth > 32) return invalid();
    whitespace();
    if (source[i] === '"') return string();
    if (source[i] === '{') {
      i++; whitespace(); const output: RecordValue = Object.create(null);
      if (source[i] === '}') { i++; return output; }
      while (i < source.length) {
        whitespace(); if (source[i] !== '"') return invalid();
        const key = string(); if (Object.hasOwn(output, key)) return invalid();
        whitespace(); if (source[i++] !== ':') return invalid();
        output[key] = value(depth + 1); whitespace();
        if (source[i] === '}') { i++; return output; }
        if (source[i++] !== ',') return invalid();
      }
      return invalid();
    }
    if (source[i] === '[') {
      i++; whitespace(); const output: unknown[] = [];
      if (source[i] === ']') { i++; return output; }
      while (i < source.length) {
        output.push(value(depth + 1)); whitespace();
        if (source[i] === ']') { i++; return output; }
        if (source[i++] !== ',') return invalid();
      }
      return invalid();
    }
    for (const [token, parsed] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(token, i)) { i += token.length; return parsed; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if (!match) return invalid();
    i += match[0].length; return match[0];
  }
  const parsed = value(0); whitespace(); if (i !== source.length) invalid(); return parsed;
}
async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    try { await response.body?.cancel(); } catch { /* No response data is retained. */ }
    throw new Error('Response exceeds bound');
  }
  if (!response.body) throw new Error('Response missing');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('Response interrupted');
    while (true) {
      const next = await reader.read();
      if (signal.aborted) throw new Error('Response interrupted');
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Response exceeds bound'); }
      chunks.push(next.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
function evaluateResponse(body: unknown, status: number, latencyMs: number, env: NodeJS.ProcessEnv,
  headerCost: string | null, remainingBudgetUsd: string): SurplusConnectionTestStatus {
  // Cost is a separate fact from model identity/output validity. Official non-streamed responses
  // can report canonical cost on errors, and the header remains useful even for malformed output.
  const bodyCostPresent = record(body) && record(body.usage) && Object.hasOwn(body.usage, 'buyer_cost_micro');
  const bodyCost = bodyCostPresent ? surplusBuyerCostToUsd((body.usage as RecordValue).buyer_cost_micro) : null;
  const responseCost = headerCost === null ? null : surplusBuyerCostToUsd(headerCost);
  const ambiguous = bodyCostPresent && bodyCost === null || headerCost !== null && responseCost === null
    || bodyCost !== null && responseCost !== null && bodyCost !== responseCost;
  const actualCostUsd = ambiguous ? null : bodyCost ?? responseCost;
  const boundOutput = record(body) && text(body.id) && body.model === MODEL && body.error === undefined && body.data === undefined;
  const choices = boundOutput ? body.choices : null;
  const choice = Array.isArray(choices) && choices.length === 1 && record(choices[0]) ? choices[0] : null;
  const message = choice && record(choice.message) ? choice.message : null;
  const validOutput = status === 200 && choice?.finish_reason === 'stop' && message?.role === 'assistant'
    && typeof message.content === 'string' && message.tool_calls === undefined && message.function_call === undefined && message.refusal == null;
  const expectedResponse = validOutput ? (message!.content as string).trim() === 'OK' ? 'matched' : 'mismatched' : 'not_checked';
  const fields = { latencyMs, actualCostUsd, expectedResponse } as const;
  if (actualCostUsd === null) return result('unknown_liability_hold', env, fields);
  if (canonicalMicro(actualCostUsd)! > canonicalMicro(remainingBudgetUsd)!) return result('budget_exceeded', env, fields);
  return result(expectedResponse === 'matched' ? 'passed' : 'failed', env, fields);
}
/**
 * One durable ATTEMPT, not a promise of exactly one network execution. A crash after reservation
 * may mean no request, and an uncertain response may mean a billed request. Both consume the gate.
 * Transactions can retry locally; fetch is strictly outside them, with no automatic HTTP retries.
 */
export async function runSurplusConnectionTest(deps: SurplusConnectionTestDependencies = {}): Promise<SurplusConnectionTestStatus> {
  const env = deps.env ?? process.env, now = deps.now ?? Date.now;
  let db: Database | null;
  let reserved: { credentialSha256: string; review: SurplusConnectionTestReview; startedAt: number } | null = null;
  try {
    db = database(deps);
    if (!db) return result('unavailable', env);
    const admission = await db.runTransaction(async tx => {
      const existing = await tx.get(db!.doc(SURPLUS_CONNECTION_TEST_DOCUMENT));
      if (existing.exists) return { cached: projectAttempt(existing.data(), env) };
      const config = configuration(env);
      if (!config.environmentConfigured || !config.productionFlagsOff) return { cached: result('blocked_configuration', env) };
      const credentialSha256 = digest(env.SURPLUS_API_KEY!.trim());
      const review = (await tx.get(db!.doc(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT))).data(), startedAt = now();
      if (!validReview(review, credentialSha256, startedAt)) return { cached: result('blocked_budget_review', env) };
      // No lease expiry, release, delete, reset or rearm path. Even an unattempted rejection consumes it.
      tx.set(db!.doc(SURPLUS_CONNECTION_TEST_DOCUMENT), { authorizationId: SURPLUS_CONNECTION_TEST_AUTHORITY,
        testId: SURPLUS_CONNECTION_TEST_ID, attempts: 1, state: 'unknown_liability_hold', startedAt,
        credentialSha256, accountId: review.accountId, reviewRevision: review.revision,
        reviewSourceSha256: review.source.artifactSha256, reviewSourceObservedAt: review.source.observedAt,
        reviewedAt: review.reviewedAt, hardStopEvidenceSha256: review.hardStop.evidenceSha256,
        automaticFundingEvidenceSha256: review.automaticFunding.evidenceSha256,
        automaticFundingObservedAt: review.automaticFunding.observedAt, automaticFundingVerifiedUntil: review.automaticFunding.verifiedUntil,
        remainingBudgetUsd: review.hardStop.remainingBudgetUsd,
        result: { status: 'unknown_liability_hold', latencyMs: null, actualCostUsd: null, expectedResponse: 'not_checked' } });
      return { reserved: { credentialSha256, review, startedAt } };
    });
    if ('cached' in admission) return admission.cached!;
    reserved = admission.reserved!;
  } catch { return result('unavailable', env); }

  let output = result('unknown_liability_hold', env);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();
  try {
    const config = configuration(env), key = env.SURPLUS_API_KEY?.trim();
    if (!config.environmentConfigured || !config.productionFlagsOff || !key || digest(key) !== reserved.credentialSha256) throw new Error('Configuration changed');
    // Re-read review after the committing transaction: a revocation before dispatch stays consumed.
    const latest = (await db.doc(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT).get()).data();
    if (!validReview(latest, reserved.credentialSha256, now()) || JSON.stringify(latest) !== JSON.stringify(reserved.review)) throw new Error('Review changed');
    const dispatchConfig = configuration(env);
    if (!dispatchConfig.environmentConfigured || !dispatchConfig.productionFlagsOff || env.SURPLUS_API_KEY?.trim() !== key) throw new Error('Configuration changed');
    const response = await (deps.fetcher ?? globalThis.fetch)(ENDPOINT, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: REQUEST });
    if (response.redirected || response.status < 200 || response.status >= 600 || response.status >= 300 && response.status < 400 || controller.signal.aborted) {
      try { await response.body?.cancel(); } catch { /* Never surface raw provider errors. */ }
      throw new Error('Response unavailable');
    }
    let body: unknown = null;
    try { body = parseExactJson(await readBounded(response, controller.signal)); } catch { /* Header cost may remain valid even if output is unreadable. */ }
    output = evaluateResponse(body, response.status, Math.max(0, now() - reserved.startedAt), env,
      response.headers.get('x-si-buyer-cost-micro'), reserved.review.hardStop.remainingBudgetUsd);
  } catch {
    output = result('unknown_liability_hold', env, { latencyMs: Math.max(0, now() - reserved.startedAt), actualCostUsd: null, expectedResponse: 'not_checked' });
  } finally { clearTimeout(timer); }
  try {
    await db.runTransaction(async tx => {
      const ref = db!.doc(SURPLUS_CONNECTION_TEST_DOCUMENT), existing = (await tx.get(ref)).data();
      if (!existing || existing.attempts !== 1 || existing.authorizationId !== SURPLUS_CONNECTION_TEST_AUTHORITY
          || existing.testId !== SURPLUS_CONNECTION_TEST_ID || existing.credentialSha256 !== reserved!.credentialSha256
          || existing.startedAt !== reserved!.startedAt || existing.state !== 'unknown_liability_hold') throw new Error('Attempt fence unavailable');
      tx.set(ref, { ...existing, state: output.actualCostUsd === null ? 'unknown_liability_hold' : 'reported', completedAt: now(),
        result: { status: output.status, latencyMs: output.latencyMs, actualCostUsd: output.actualCostUsd, expectedResponse: output.expectedResponse } });
    });
    return output;
  } catch { return result('unknown_liability_hold', env); }
}

/**
 * Official non-inference endpoint: https://www.surplusintelligence.ai/docs/getting-started/buyer-quickstart
 * A 200 authenticates this credential only. It does not prove model access, funding, output or quality.
 * No account, balance, wallet, credential, provider error or body is returned, logged or persisted.
 */
export async function runSurplusCredentialCheck(deps: SurplusConnectionTestDependencies = {}): Promise<{ status: 'accepted' | 'rejected' | 'unavailable' }> {
  const env = deps.env ?? process.env, config = configuration(env);
  if (!config.environmentConfigured || !config.productionFlagsOff) return { status: 'unavailable' };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await (deps.fetcher ?? globalThis.fetch)(AUTH_ENDPOINT, { method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${env.SURPLUS_API_KEY!.trim()}`, Accept: 'application/json' } });
    // Do not read a body containing balances, account details, wallets or raw errors.
    try { await response.body?.cancel(); } catch { /* The response body remains discarded. */ }
    if (response.redirected || controller.signal.aborted) return { status: 'unavailable' };
    // 403 may be a profile-read scope restriction, not an invalid credential.
    const jsonResponse = /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
    return { status: response.status === 200 && jsonResponse ? 'accepted' : response.status === 401 ? 'rejected' : 'unavailable' };
  } catch { return { status: 'unavailable' }; }
  finally { clearTimeout(timer); }
}
