/** Offline transaction/clock proofs, not live Firestore contention or provider-quota evidence. */
import { describe, expect, it } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { civilDayWindow, DAY_MS } from '../FreeChain/quota';
import { gatewayAccountFencePath, gatewayAccountScopeIds, type GatewayAccountFence } from './accountMigration';
import { gatewayLedgerPath } from './firestoreLedger';
import { evidenceBinding, quotaLedgerKey } from './profiles';
import { GatewayQuotaRollover, gatewayQuotaImportPath, gatewayQuotaRulePath, gatewayQuotaWindow,
  reviewedGatewayQuotaRule, type GatewayQuotaRule, type GatewayQuotaRolloverRequest, type GatewayQuotaUsageImport,
  type GatewayRolloverPolicy } from './quotaRollover';
import type { QuotaDimension } from './types';

function database() {
  const docs = new Map<string, any>(); const versions = new Map<string, number>();
  let beforeCommit: (() => void) | undefined; let afterCommit: (() => void) | undefined;
  let onRead: ((path: string) => void) | undefined; let loseNextResponse = false; let retries = 0;
  const writes: string[] = []; const reads: string[] = []; const options: unknown[] = [];
  const seed = (path: string, value: unknown) => { docs.set(path, structuredClone(value)); versions.set(path, (versions.get(path) ?? 0) + 1); };
  const db = { doc: (path: string) => ({ path }), async runTransaction<T>(body: (tx: Transaction) => Promise<T>, opts?: unknown): Promise<T> {
    options.push(opts);
    for (let round = 0; round < 5; round++) {
      const observed = new Map<string, number>(); const pending = new Map<string, unknown>();
      const tx = { async get(ref: { path: string }) {
        if (pending.size) throw new Error('Read after write'); onRead?.(ref.path); reads.push(ref.path);
        observed.set(ref.path, versions.get(ref.path) ?? 0); const value = structuredClone(docs.get(ref.path));
        return { exists: docs.has(ref.path), data: () => value };
      }, create(ref: { path: string }, value: unknown) {
        if (!observed.has(ref.path) || docs.has(ref.path)) throw new Error('Create requires observed absence');
        pending.set(ref.path, structuredClone(value));
      }, set(ref: { path: string }, value: unknown) { pending.set(ref.path, structuredClone(value)); } };
      const result = await body(tx as unknown as Transaction);
      const hook = beforeCommit; beforeCommit = undefined; hook?.();
      if ([...observed].some(([path, version]) => (versions.get(path) ?? 0) !== version)) { retries++; continue; }
      for (const [path, value] of pending) { seed(path, value); writes.push(path); }
      const after = afterCommit; afterCommit = undefined; after?.();
      if (loseNextResponse && pending.size) { loseNextResponse = false; throw new Error('Committed response lost'); }
      return result;
    }
    throw new Error('Contention exhausted');
  } } as unknown as Pick<Firestore, 'doc' | 'runTransaction'>;
  return { db, docs, writes, reads, options, seed, get retries() { return retries; },
    beforeCommit: (fn: () => void) => { beforeCommit = fn; }, afterCommit: (fn: () => void) => { afterCommit = fn; },
    onRead: (fn: (path: string) => void) => { onRead = fn; }, loseResponse: () => { loseNextResponse = true; } };
}
const NOW = Date.parse('2026-10-22T12:00:01.000Z');
function fixture(count = 1, initialNow = NOW) {
  const state = database(); let now = initialNow;
  const dimensions: QuotaDimension[] = Array.from({ length: count }, (_, index) => ({
    scope: { providerId: 'GROQ', kind: index === 0 ? 'account' : 'organization', id: index === 0 ? 'canonical-account' : `canonical-org-${index}` },
    meter: index === 0 ? 'tokens/minute' : 'requests/day',
  }));
  const account: GatewayAccountFence = { kind: 'gateway_account_owner', version: 2, provider: 'groq',
    migrationId: 'review-generation-one', authority: 'gateway-local-capacity', accountScopeIds: gatewayAccountScopeIds(dimensions),
    credentialBindings: ['a'.repeat(64)], accountReviewRef: 'independent-account-review', upstreamQuota: 'unknown',
    reviewedAtMs: now - 60_000, expiresAtMs: now + DAY_MS - 60_000 };
  const accountPath = gatewayAccountFencePath(account.provider, account.accountScopeIds); state.seed(accountPath, account);
  const rules = dimensions.map(dimension => {
    const key = quotaLedgerKey(dimension);
    const rule: GatewayQuotaRule = { kind: 'gateway_quota_rule', version: 1, ledgerKey: key, revision: 1,
      dimension, overlappingDimensions: dimensions, migrationId: account.migrationId, limit: 1000,
      reviewRef: 'reviewed-local-pressure-limit', reviewedAtMs: account.reviewedAtMs, expiresAtMs: account.expiresAtMs,
      reset: { kind: 'fixed-interval', anchorAtMs: 0, intervalMs: 60_000 }, accounting: 'local-only',
      accountPolicyPath: accountPath, accountPolicyBinding: evidenceBinding(account),
      zeroBaseline: { kind: 'local-reservation-window', evidenceRef: 'review-of-local-reservation-attribution' } };
    const window = gatewayQuotaWindow(rule, now - 60_000)!;
    const policy: GatewayRolloverPolicy = { kind: 'gateway_quota_policy', version: 1, ledgerKey: key, revision: 1,
      authority: 'gateway-local-capacity', accountingBasis: 'gateway-local-only', migrationId: account.migrationId,
      limit: rule.limit, window, rolloverRule: { revision: rule.revision, binding: evidenceBinding(rule) } };
    state.seed(gatewayQuotaRulePath(key), rule); state.seed(gatewayLedgerPath('quota-policy', key), policy);
    state.seed(gatewayLedgerPath('quota-state', key), { kind: 'gateway_quota_state', version: 1, ledgerKey: key,
      migrationId: account.migrationId, held: 17, quarantined: false });
    state.seed(gatewayLedgerPath('quota-period', evidenceBinding([key, window.id])), { kind: 'gateway_quota_period', version: 1, ledgerKey: key, window, spent: 983 });
    return rule;
  });
  const request: GatewayQuotaRolloverRequest = { dimensions, operationId: 'rollover-operation-one',
    expectedPolicyRevisions: dimensions.map(d => ({ ledgerKey: quotaLedgerKey(d), revision: 1 })) };
  const worker = new GatewayQuotaRollover(state.db, { now: () => now });
  const policy = (index = 0) => state.docs.get(gatewayLedgerPath('quota-policy', rules[index].ledgerKey)) as GatewayRolloverPolicy;
  const quotaState = (index = 0) => state.docs.get(gatewayLedgerPath('quota-state', rules[index].ledgerKey));
  const updateRule = (index: number, change: Partial<GatewayQuotaRule>) => {
    const rule = JSON.parse(JSON.stringify({ ...rules[index], ...change })) as GatewayQuotaRule; rules[index] = rule; state.seed(gatewayQuotaRulePath(rule.ledgerKey), rule);
    state.seed(gatewayLedgerPath('quota-policy', rule.ledgerKey), { ...policy(index), rolloverRule: { revision: rule.revision, binding: evidenceBinding(rule) } });
    return rule;
  };
  const usageImport = (index = 0, change: Partial<GatewayQuotaUsageImport> = {}) => {
    const rule = rules[index]; const p = policy(index); const importId = `authenticated-import-${index}`;
    const value: GatewayQuotaUsageImport = { kind: 'gateway_quota_usage_import', version: 1, id: importId,
      ledgerKey: rule.ledgerKey, ruleRevision: rule.revision, ruleBinding: evidenceBinding(rule),
      accountPolicyBinding: rule.accountPolicyBinding, previousPolicyBinding: evidenceBinding(p), previousStateBinding: evidenceBinding(quotaState(index)),
      sourceId: rule.usageSource!.id, sourceEvidenceRef: rule.usageSource!.evidenceRef, evidenceRef: 'verified-source-response-id',
      observedAtMs: now, expiresAtMs: now + 60_000, window: gatewayQuotaWindow(rule, now) ?? { id: 'authoritative-window-one', startsAtMs: now - 1000, endsAtMs: now + 59_000 },
      spent: 23, coverage: 'complete-through-observation', ...change };
    state.seed(gatewayQuotaImportPath(rule.ledgerKey, importId), value);
    request.imports = [...request.imports ?? [], { ledgerKey: rule.ledgerKey, importId }]; return value;
  };
  return { ...state, worker, rules, dimensions, request, account, accountPath, policy, quotaState, updateRule, usageImport, get retries() { return state.retries; },
    get now() { return now; }, setNow: (value: number) => { now = value; } };
}

describe('reviewed canonical quota rollover', () => {
  it('reports readiness without writes, then rolls local allowance while upstream remains explicitly unknown', async () => {
    const f = fixture(); const old = structuredClone([...f.docs]);
    expect(await f.worker.inspect(f.request)).toMatchObject({ status: 'ready', committed: false,
      dimensions: [{ held: 17, spent: 0, accounting: 'local-only', upstreamRemaining: 'unknown' }] });
    expect([...f.docs]).toEqual(old); expect(f.writes).toEqual([]);
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'rolled', committed: true, dimensions: [{ policyRevision: 2, held: 17, spent: 0 }] });
    expect(f.quotaState().held).toBe(17); expect(f.writes).toHaveLength(2);
    for (const [path, value] of old) if (!path.includes('gateway_quota_policy_')) expect(f.docs.get(path)).toEqual(value);
    expect(f.options).toEqual([{ maxAttempts: 5 }, { maxAttempts: 5 }]);
  });
  it('skips missed windows directly and never renews account or rule review', async () => {
    const f = fixture(); f.setNow(NOW + 5 * 60_000);
    const rule = structuredClone(f.rules[0]); const account = structuredClone(f.account);
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'rolled' });
    expect(f.policy().window).toEqual(gatewayQuotaWindow(rule, f.now));
    expect([...f.docs.values()].filter(d => d.kind === 'gateway_quota_period')).toHaveLength(2);
    expect(f.docs.get(f.accountPath)).toEqual(account); expect(f.docs.get(gatewayQuotaRulePath(rule.ledgerKey))).toEqual(rule);
  });
  it('atomically rolls the entire exact overlap set, never a convenient subset', async () => {
    const f = fixture(2); const subset = { ...f.request, dimensions: [f.dimensions[0]], expectedPolicyRevisions: [f.request.expectedPolicyRevisions[0]] };
    expect(await f.worker.rollover(subset)).toMatchObject({ status: 'blocked', reason: 'invalid-rule' }); expect(f.writes).toHaveLength(0);
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'rolled', dimensions: [{ policyRevision: 2 }, { policyRevision: 2 }] });
    expect(f.writes).toHaveLength(4); expect(f.quotaState(0).held).toBe(17); expect(f.quotaState(1).held).toBe(17);
  });
  it('does not partially write when a later overlap dimension lacks its canonical state', async () => {
    const f = fixture(2); f.docs.delete(gatewayLedgerPath('quota-state', f.rules[1].ledgerKey));
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'missing-state' });
    expect(f.policy().revision).toBe(1); expect(f.writes).toHaveLength(0);
  });
  it('serializes concurrent duplicate jobs by CAS and creates one period only', async () => {
    const f = fixture(); const result = await Promise.all([f.worker.rollover(f.request), f.worker.rollover(f.request)]);
    expect(result.map(r => r.status).sort()).toEqual(['current', 'rolled']); expect(f.retries).toBeGreaterThan(0);
    expect(f.writes).toHaveLength(2); expect(f.policy().revision).toBe(2);
  });
  it('rejects a stale different operation rather than treating CAS conflict as new allowance', async () => {
    const f = fixture(); await f.worker.rollover(f.request);
    expect(await f.worker.rollover({ ...f.request, operationId: 'different-operation' })).toMatchObject({ status: 'blocked', reason: 'policy-conflict' });
    expect(f.writes).toHaveLength(2);
  });
  it('reconciles a lost commit response with the same operation without duplicate allowance', async () => {
    const f = fixture(); f.loseResponse();
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', committed: 'unknown', reason: 'store-unavailable' });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'current', committed: false });
    expect(f.writes).toHaveLength(2); expect(f.quotaState().held).toBe(17);
  });
  it('re-reads changed held totals on transactional retry instead of replacing them with a stale value', async () => {
    const f = fixture(); const path = gatewayLedgerPath('quota-state', f.rules[0].ledgerKey);
    f.beforeCommit(() => f.seed(path, { ...f.quotaState(), held: 117 }));
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'rolled', dimensions: [{ held: 117 }] });
    expect(f.retries).toBe(1); expect(f.quotaState().held).toBe(117);
  });
  it.each(['unknown', 'rolling'] as const)('fails closed for %s semantics without authenticated import, even when a zero proof exists', async semantics => {
    const f = fixture(); f.updateRule(0, { reset: { kind: 'authoritative-import', semantics } });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'import-required' }); expect(f.writes).toHaveLength(0);
  });
  it.each(['unknown', 'rolling'] as const)('accepts an exact authenticated conservative import for %s semantics without releasing earlier held usage', async semantics => {
    const f = fixture(); f.updateRule(0, { reset: { kind: 'authoritative-import', semantics },
      usageSource: { id: 'authenticated-server-source', evidenceRef: 'source-review', maxAgeMs: 30_000 } });
    f.usageImport();
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'rolled', dimensions: [{ spent: 23, held: 17, upstreamRemaining: 'unknown' }] });
    expect(f.policy().rollover?.baseline).toBe('authenticated-import'); expect(f.quotaState().held).toBe(17);
  });
  it('does not trust a manually seeded active unknown period without imported provenance', async () => {
    const f = fixture(); f.updateRule(0, { reset: { kind: 'authoritative-import', semantics: 'unknown' } });
    f.setNow(NOW - 2000);
    expect(await f.worker.inspect(f.request)).toMatchObject({ status: 'blocked', reason: 'import-required' });
    expect(f.writes).toHaveLength(0);
  });
  it('rechecks active rolling-window import provenance and freshness after successful rollover', async () => {
    const f = fixture(); f.updateRule(0, { reset: { kind: 'authoritative-import', semantics: 'rolling' },
      usageSource: { id: 'authenticated-source', evidenceRef: 'source-review', maxAgeMs: 500 } });
    f.usageImport(); expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'rolled' });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'current' });
    f.setNow(NOW + 501);
    expect(await f.worker.inspect(f.request)).toMatchObject({ status: 'blocked', reason: 'invalid-import' });
    expect(f.writes).toHaveLength(2); expect(f.quotaState().held).toBe(17);
  });
  it('allows current mutable counters above an authenticated imported baseline but never below it', async () => {
    const f = fixture(); f.updateRule(0, { reset: { kind: 'authoritative-import', semantics: 'rolling' },
      usageSource: { id: 'authenticated-source', evidenceRef: 'source-review', maxAgeMs: 30_000 } });
    f.usageImport(); await f.worker.rollover(f.request);
    const statePath = gatewayLedgerPath('quota-state', f.rules[0].ledgerKey);
    const periodPath = gatewayLedgerPath('quota-period', evidenceBinding([f.rules[0].ledgerKey, f.policy().window.id]));
    f.seed(statePath, { ...f.quotaState(), held: 117 });
    f.seed(periodPath, { ...f.docs.get(periodPath), spent: 73 });
    expect(await f.worker.inspect(f.request)).toMatchObject({ status: 'current', dimensions: [{ spent: 73, held: 117 }] });
    f.seed(statePath, { ...f.quotaState(), held: 0 });
    expect(await f.worker.inspect(f.request)).toMatchObject({ status: 'current', dimensions: [{ spent: 73, held: 0 }] });
    f.seed(periodPath, { ...f.docs.get(periodPath), spent: 22 });
    expect(await f.worker.inspect(f.request)).toMatchObject({ status: 'blocked', reason: 'invalid-import' });
    expect(f.writes).toHaveLength(2);
  });
  it('blocks a formerly valid current import when its source authority expires', async () => {
    const f = fixture(); f.updateRule(0, { reset: { kind: 'authoritative-import', semantics: 'unknown' },
      usageSource: { id: 'authenticated-source', evidenceRef: 'source-review', maxAgeMs: 30_000 } });
    const imported = f.usageImport(); await f.worker.rollover(f.request);
    f.seed(gatewayQuotaImportPath(imported.ledgerKey, imported.id), { ...imported, expiresAtMs: NOW });
    expect(await f.worker.inspect(f.request)).toMatchObject({ status: 'blocked', reason: 'invalid-import' });
    expect(f.writes).toHaveLength(2); expect(f.quotaState().held).toBe(17);
  });
  it('never silently assumes zero without reviewed local reset attribution', async () => {
    const f = fixture(); f.updateRule(0, { zeroBaseline: undefined });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'import-required' }); expect(f.writes).toHaveLength(0);
  });
  it('requires a fresh exact import and rejects a state mutation after observation', async () => {
    const f = fixture(); f.updateRule(0, { zeroBaseline: undefined,
      usageSource: { id: 'authenticated-source', evidenceRef: 'source-review', maxAgeMs: 500 } });
    f.usageImport(); f.setNow(NOW + 501);
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'invalid-import' });
    f.setNow(NOW); f.seed(gatewayLedgerPath('quota-state', f.rules[0].ledgerKey), { ...f.quotaState(), held: 18 });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'invalid-import' }); expect(f.writes).toHaveLength(0);
  });
  it.each(['ruleBinding', 'previousPolicyBinding', 'accountPolicyBinding', 'sourceId', 'sourceEvidenceRef'] as const)('rejects imported evidence with wrong %s', async field => {
    const f = fixture(); f.updateRule(0, { usageSource: { id: 'authenticated-source', evidenceRef: 'source-review', maxAgeMs: 30_000 } });
    f.usageImport(0, { [field]: 'wrong-binding' });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'invalid-import' }); expect(f.writes).toHaveLength(0);
  });
  it('never overwrites an existing next period or resets its spent usage', async () => {
    const f = fixture(); const window = gatewayQuotaWindow(f.rules[0], f.now)!;
    const path = gatewayLedgerPath('quota-period', evidenceBinding([f.rules[0].ledgerKey, window.id]));
    f.seed(path, { kind: 'gateway_quota_period', version: 1, ledgerKey: f.rules[0].ledgerKey, window, spent: 899 });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'period-conflict' });
    expect(f.docs.get(path).spent).toBe(899); expect(f.writes).toHaveLength(0);
  });
  it.each(['expiresAt', 'expireAt'])('rejects TTL-bearing held state (%s)', async ttl => {
    const f = fixture(); f.seed(gatewayLedgerPath('quota-state', f.rules[0].ledgerKey), { ...f.quotaState(), [ttl]: new Date(NOW) });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'invalid-state' });
  });
  it('preserves quarantine and refuses to turn recovery into rollover', async () => {
    const f = fixture(); f.seed(gatewayLedgerPath('quota-state', f.rules[0].ledgerKey), { ...f.quotaState(), quarantined: true });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'quarantined' }); expect(f.writes).toHaveLength(0);
  });
  it('rejects a changed account review, scope or credential generation even at the same path', async () => {
    const f = fixture(); f.seed(f.accountPath, { ...f.account, credentialBindings: ['b'.repeat(64)] });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'account-unavailable' }); expect(f.writes).toHaveLength(0);
  });
  it('does not upgrade local unknown account quota into verified upstream capacity', async () => {
    const f = fixture(); f.updateRule(0, { accounting: 'upstream-verified', zeroBaseline: { kind: 'exclusive-provider-reset', evidenceRef: 'claim', exclusiveSinceMs: 0 } });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'account-unavailable' }); expect(f.writes).toHaveLength(0);
  });
  it('checks review expiry again after all reads and does not write', async () => {
    const f = fixture(); const next = gatewayQuotaWindow(f.rules[0], f.now)!;
    const path = gatewayLedgerPath('quota-period', evidenceBinding([f.rules[0].ledgerKey, next.id]));
    f.onRead(p => { if (p === path) f.setNow(f.rules[0].expiresAtMs); });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'review-expired', committed: false }); expect(f.writes).toHaveLength(0);
  });
  it('checks reset boundary again after all reads and does not create a stale period', async () => {
    const f = fixture(); const next = gatewayQuotaWindow(f.rules[0], f.now)!;
    f.onRead(path => { if (path === gatewayLedgerPath('quota-period', evidenceBinding([f.rules[0].ledgerKey, next.id]))) f.setNow(next.endsAtMs); });
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'clock-changed', committed: false }); expect(f.writes).toHaveLength(0);
  });
  it('reports a postcommit boundary change honestly and preserves committed data', async () => {
    const f = fixture(); const next = gatewayQuotaWindow(f.rules[0], f.now)!; f.afterCommit(() => f.setNow(next.endsAtMs));
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', committed: true, reason: 'clock-changed' });
    expect(f.policy().revision).toBe(2); expect(f.writes).toHaveLength(2); expect(f.quotaState().held).toBe(17);
  });
  it('rejects backward clocks before writes', async () => {
    const f = fixture(); f.onRead(() => f.setNow(NOW - 1));
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'clock-changed' }); expect(f.writes).toHaveLength(0);
  });
  it('supports subsequent windows without recycling the previous operation ID/revision', async () => {
    const f = fixture(); await f.worker.rollover(f.request); f.setNow(NOW + 60_000);
    expect(await f.worker.rollover(f.request)).toMatchObject({ status: 'blocked', reason: 'clock-changed' });
    const request = { ...f.request, operationId: 'next-window-operation', expectedPolicyRevisions: [{ ledgerKey: f.rules[0].ledgerKey, revision: 2 }] };
    expect(await f.worker.rollover(request)).toMatchObject({ status: 'rolled', dimensions: [{ policyRevision: 3 }] });
    expect([...f.docs.values()].filter(d => d.kind === 'gateway_quota_period')).toHaveLength(3); expect(f.quotaState().held).toBe(17);
  });
  it.each([0, 33])('bounds operation overlap count to one through 32 (%s)', async count => {
    const f = fixture(); const request = { ...f.request, dimensions: Array.from({ length: count }, () => f.dimensions[0]) };
    expect(await f.worker.rollover(request)).toMatchObject({ status: 'blocked', reason: 'invalid-request' }); expect(f.reads).toHaveLength(0);
  });
});

describe('explicit reset semantics', () => {
  it.each([
    ['2026-03-08T16:00:00Z', 23], ['2026-11-01T17:00:00Z', 25],
  ])('derives actual America/New_York DST boundaries at %s', (time, hours) => {
    const f = fixture(); const now = Date.parse(time as string); const rule = { ...f.rules[0], reset: { kind: 'civil-day' as const, timeZone: 'America/New_York' } };
    const window = gatewayQuotaWindow(rule, now)!; const civil = civilDayWindow(now, 'America/New_York');
    expect(window.endsAtMs - window.startsAtMs).toBe((hours as number) * 3_600_000);
    expect(window.startsAtMs).toBe(civil.startAt); expect(window.endsAtMs).toBe(civil.resetAt);
  });
  it('does not mint a different period when human review revision renews mid-window', () => {
    const f = fixture(); const rule = f.rules[0];
    expect(gatewayQuotaWindow({ ...rule, revision: 2, reviewedAtMs: NOW, expiresAtMs: NOW + 10_000 }, NOW)).toEqual(gatewayQuotaWindow(rule, NOW));
  });
  it('does not infer civil reset rules from requests/day or silently accept unsupported zones', () => {
    const f = fixture(); expect(() => reviewedGatewayQuotaRule({ ...f.rules[0], reset: { kind: 'civil-day', timeZone: 'unknown/timezone' } }, f.dimensions[0], f.dimensions, NOW)).toThrow();
    expect(() => reviewedGatewayQuotaRule({ ...f.rules[0], reset: undefined }, f.dimensions[0], f.dimensions, NOW)).toThrow();
  });
  it('uses the exact fixed reset anchor rather than wall-clock minute rounding', () => {
    const f = fixture(); const rule = { ...f.rules[0], reset: { kind: 'fixed-interval' as const, anchorAtMs: 15_000, intervalMs: 60_000 } };
    expect(gatewayQuotaWindow(rule, NOW)!.startsAtMs % 60_000).toBe(15_000);
    expect(gatewayQuotaWindow(rule, NOW + 14_000)!.startsAtMs).toBe(NOW + 14_000);
  });
});
