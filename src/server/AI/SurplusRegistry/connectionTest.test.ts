import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSurplusConnectionTestStatus, runSurplusConnectionTest, runSurplusCredentialCheck,
  SURPLUS_CONNECTION_TEST_AUTHORITY, SURPLUS_CONNECTION_TEST_DOCUMENT, SURPLUS_CONNECTION_TEST_ID,
  SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, type SurplusConnectionTestDependencies, type SurplusConnectionTestReview } from './connectionTest';

const NOW = 1_800_000_000_000;
const KEY = 'inf_synthetic_connection_test_key';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function review(): SurplusConnectionTestReview {
  return { schemaVersion: 1, authorizationId: SURPLUS_CONNECTION_TEST_AUTHORITY, testId: SURPLUS_CONNECTION_TEST_ID,
    revision: 1, accountId: 'synthetic-account', credentialBinding: { keyId: 'synthetic-provider-key-id', accountId: 'synthetic-account', workspaceId: 'synthetic-workspace', memberId: 'synthetic-member' }, credentialSha256: sha(KEY), credentialState: 'active', accountState: 'active',
    reviewMethod: 'independent-provider-account-evidence', reviewedBy: 'synthetic-independent-review', reviewedAt: NOW - 1_000,
    expiresAt: NOW + 120_000, source: { url: 'https://surplusintelligence.ai/account', artifactSha256: 'a'.repeat(64), observedAt: NOW - 2_000 },
    automaticFunding: { accountId: 'synthetic-account', enabled: false, observedAt: NOW - 1_500, verifiedUntil: NOW + 120_000, evidenceSha256: 'a'.repeat(64) },
    hardStop: { kind: 'reviewed-provider-spend-budget', currency: 'USD', configuredLimitUsd: '1', reportedSpendUsd: '0', remainingBudgetUsd: '1',
      scope: 'key', scopeId: 'synthetic-provider-key-id', period: 'month', resetsAt: NOW + 3_600_000,
      accountId: 'synthetic-account', credentialSha256: sha(KEY),
      testId: SURPLUS_CONNECTION_TEST_ID, active: true, paused: false, hard_stop: true, verifiedAt: NOW - 1_500, verifiedUntil: NOW + 120_000, evidenceSha256: 'a'.repeat(64) } };
}
const wire = (changes: Record<string, unknown> = {}) => ({ id: 'synthetic-response-id', model: 'deepseek-v4.1-flash',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }], usage: { buyer_cost_micro: 29 }, ...changes });
function setup() {
  const docs = new Map<string, any>([[SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, review()]]);
  let queue: Promise<unknown> = Promise.resolve();
  const options: { unavailable?: boolean; failFinalWrite?: boolean; uncertainCommit?: boolean; afterReservation?: () => void; onRead?: (path: string) => Promise<void> } = {};
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  const db = {
    doc: (path: string) => ({ path, get: async () => { if (options.unavailable) throw new Error('raw database secret'); await options.onRead?.(path); return snapshot(path); } }),
    runTransaction: (fn: (tx: any) => Promise<any>) => {
      const next = queue.then(async () => {
        if (options.unavailable) throw new Error('raw database secret');
        const writes = new Map<string, unknown>();
        const result = await fn({ get: async (ref: { path: string }) => snapshot(ref.path),
          set: (ref: { path: string }, value: unknown) => writes.set(ref.path, structuredClone(value)) });
        const final = [...writes.values()].some((value: any) => value.completedAt !== undefined);
        if (final && options.failFinalWrite) throw new Error('raw write failure');
        for (const [key, value] of writes) docs.set(key, value);
        if (writes.size && !final) {
          options.afterReservation?.();
          if (options.uncertainCommit) throw new Error('uncertain commit acknowledgement');
        }
        return result;
      });
      queue = next.catch(() => {}); return next;
    },
  };
  const env: NodeJS.ProcessEnv = { K_SERVICE: 'synthetic-cloud-run-service', SURPLUS_API_KEY: KEY,
    AGENTV3_SURPLUS_BUILDER: 'false', SURPLUS_REGISTRY_ENABLED: 'off' };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(wire()), { status: 200, headers: { 'content-type': 'application/json' } }));
  const deps: SurplusConnectionTestDependencies = { db: db as never, env, fetcher: fetcher as typeof fetch, now: () => NOW };
  return { docs, db, options, env, fetcher, deps, stored: () => docs.get(SURPLUS_CONNECTION_TEST_DOCUMENT) };
}
afterEach(() => vi.useRealTimers());

describe('independent connection-test authority', () => {
  it('reports reviewed readiness without provider I/O or reserving an attempt', async () => {
    const t = setup();
    expect(await getSurplusConnectionTestStatus(t.deps)).toEqual({ status: 'ready', environmentConfigured: true, productionFlagsOff: true,
      latencyMs: null, actualCostUsd: null, expectedResponse: 'not_checked' });
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored()).toBeUndefined();
  });
  it('does not seed or infer approval from a key, token cap, or user budget', async () => {
    const t = setup(); t.docs.delete(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT);
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('blocked_budget_review');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_budget_review');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.docs.size).toBe(0);
  });
  it.each([
    undefined, null, {},
    { ...review().automaticFunding, enabled: true },
    { ...review().automaticFunding, enabled: 'false' },
    { ...review().automaticFunding, accountId: 'different-account' },
    { ...review().automaticFunding, observedAt: NOW - 2_001 },
    { ...review().automaticFunding, observedAt: NOW + 1 },
    { ...review().automaticFunding, verifiedUntil: NOW - 1 },
    { ...review().automaticFunding, verifiedUntil: NOW + 60_000 },
    { ...review().automaticFunding, verifiedUntil: NOW + 100_000 },
    { ...review().automaticFunding, evidenceSha256: 'b'.repeat(64) },
  ])('requires current account-bound automatic funding OFF evidence for paid inference: %j', async automaticFunding => {
    const t = setup(); t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, { ...review(), automaticFunding });
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('blocked_budget_review');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_budget_review');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored()).toBeUndefined();
    // This harmless authentication request neither funds the account nor invokes a model.
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: 'accepted' });
    expect(t.fetcher).toHaveBeenCalledTimes(1);
    expect((t.fetcher.mock.calls[0] as unknown as [string])[0]).toBe('https://api.surplusintelligence.ai/v1/buyer/me');
    expect(t.stored()).toBeUndefined();
  });
  it.each([[300_000, 'ready'], [300_001, 'blocked_budget_review']] as const)('bounds funding observation age %s ms at admission', async (age, expected) => {
    const t = setup(); const r = review(); r.source.observedAt = NOW - 400_000; r.automaticFunding.observedAt = NOW - age;
    t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, r);
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe(expected);
    if (expected === 'blocked_budget_review') expect((await runSurplusConnectionTest(t.deps)).status).toBe(expected);
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored()).toBeUndefined();
  });
  it('rechecks funding freshness after the asynchronous final review read and before HTTP', async () => {
    const t = setup(); const r = review(); let current = NOW;
    r.source.observedAt = NOW - 400_000; r.automaticFunding.observedAt = NOW - 299_999;
    t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, r); t.deps.now = () => current;
    t.options.onRead = async path => { if (path === SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT) current += 2; };
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored().attempts).toBe(1);
  });
  it('rechecks automatic funding evidence after reservation and retains the fence if it changes', async () => {
    const t = setup();
    t.options.afterReservation = () => {
      const changed = review();
      t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, { ...changed, automaticFunding: { ...changed.automaticFunding, enabled: true } });
    };
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored().attempts).toBe(1);
  });
  it.each([
    { K_SERVICE: undefined }, { SURPLUS_API_KEY: undefined }, { SURPLUS_API_KEY: 'inf_admin_secret' },
    { SURPLUS_API_KEY: 'replace_with_your_surplus_api_key' }, { SURPLUS_API_KEY: 'inf_credential\nsecret' },
    { SURPLUS_API_KEY: 'not-standard-key' }, { AGENTV3_SURPLUS_BUILDER: 'on' }, { SURPLUS_REGISTRY_ENABLED: 'true' },
    { AGENTV3_SURPLUS_BUILDER: undefined }, { SURPLUS_REGISTRY_ENABLED: 'typo' },
  ])('rejects unavailable runtime or anything except two explicit OFF flags: %j', async change => {
    const t = setup(); Object.assign(t.env, change);
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('blocked_configuration');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_configuration');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored()).toBeUndefined();
  });
  it('distinguishes environment credential configuration from production manager flags', async () => {
    const t = setup(); t.env.SURPLUS_REGISTRY_ENABLED = 'true';
    expect(await getSurplusConnectionTestStatus(t.deps)).toMatchObject({ environmentConfigured: true, productionFlagsOff: false, status: 'blocked_configuration' });
    t.env.SURPLUS_REGISTRY_ENABLED = 'off'; delete t.env.SURPLUS_API_KEY;
    expect(await getSurplusConnectionTestStatus(t.deps)).toMatchObject({ environmentConfigured: false, productionFlagsOff: true });
  });
  it.each([
    { schemaVersion: 2 }, { authorizationId: 'different-owner-approval' }, { testId: 'new-test-id' }, { revision: 0 },
    { accountId: '' }, { credentialSha256: 'b'.repeat(64) }, { credentialState: 'paused' }, { accountState: 'inactive' },
    { reviewMethod: 'self-approved' }, { reviewedBy: '' }, { reviewedAt: NOW + 1 }, { expiresAt: NOW + 60_000 },
    { source: { ...review().source, url: 'https://untrusted.example/account' } },
    { source: { ...review().source, url: 'https://surplusintelligence.ai/account?credential=secret' } },
    { source: { ...review().source, artifactSha256: 'not-a-hash' } },
    { source: { ...review().source, observedAt: NOW + 1 } },
  ])('rejects absent, expired, unbound, or unverified review evidence: %j', async change => {
    const t = setup(); t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, { ...review(), ...change });
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_budget_review');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored()).toBeUndefined();
  });
  it.each([
    { kind: 'estimated-budget' }, { currency: 'USDC' }, { remainingBudgetUsd: '1.000001' }, { remainingBudgetUsd: 'NaN' },
    { remainingBudgetUsd: '0' }, { remainingBudgetUsd: '01' }, { remainingBudgetUsd: '1.0' },
    { scope: 'unbound' }, { accountId: 'different-account' }, { credentialSha256: 'c'.repeat(64) }, { testId: 'new-id' },
    { active: false }, { paused: true }, { hard_stop: false }, { scopeId: '' },
    { configuredLimitUsd: '2' }, { reportedSpendUsd: '2' }, { reportedSpendUsd: 'NaN' },
    { period: 'unknown' }, { period: 'day' }, { resetsAt: NOW + 60_000 }, { resetsAt: NOW + 100_000 }, { period: 'lifetime', resetsAt: NOW + 3_600_000 },
    { verifiedAt: NOW + 1 }, { verifiedUntil: NOW + 60_000 }, { evidenceSha256: 'b'.repeat(64) },
  ])('rejects limits that do not establish the reviewed aggregate $1 boundary: %j', async change => {
    const t = setup(); const r = review(); Object.assign(r.hardStop, change); t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, r);
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_budget_review');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored()).toBeUndefined();
  });
  it.each([
    { configuredLimitUsd: '2', reportedSpendUsd: '0', remainingBudgetUsd: '2' },
    { configuredLimitUsd: '1', reportedSpendUsd: '1', remainingBudgetUsd: '0' },
    { configuredLimitUsd: '1', reportedSpendUsd: '0.5', remainingBudgetUsd: '1' },
    { scope: 'key', scopeId: 'unrelated-key' },
    { scope: 'workspace', scopeId: 'unrelated-workspace' },
    { scope: 'member', scopeId: 'unrelated-member' },
    { scope: 'account', scopeId: 'unrelated-account' },
  ])('rejects excess, exhausted, inconsistent, or unrelated-scope current budgets: %j', async change => {
    const t = setup(); const r = review(); Object.assign(r.hardStop, change); t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, r);
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_budget_review'); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it.each(['account', 'workspace', 'member', 'key'] as const)('accepts only the budget containing this reviewed credential in %s scope', async scope => {
    const t = setup(); const r = review(); r.hardStop.scope = scope;
    r.hardStop.scopeId = ({ account: r.credentialBinding.accountId, workspace: r.credentialBinding.workspaceId,
      member: r.credentialBinding.memberId, key: r.credentialBinding.keyId })[scope]!;
    t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, r);
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('ready');
  });
  it('rejects stale speculative review schemas rather than treating earlier attestations as a configured budget', async () => {
    const t = setup(); const r = review();
    t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, { ...r, hardStop: { kind: 'provider-enforced-total-liability-cap',
      maximumLiabilityUsd: '1', active: true, paused: false, includesAllCharges: true, includesInFlightCharges: true,
      accountId: r.accountId, credentialSha256: r.credentialSha256, testId: r.testId, evidenceSha256: r.source.artifactSha256 } });
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_budget_review'); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it.each([undefined, { keyId: 'key' }, { ...review().credentialBinding, accountId: 'different' }])('rejects absent or mismatched credential membership %j', async credentialBinding => {
    const t = setup(); t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, { ...review(), credentialBinding });
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_budget_review'); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it('uses independently verified current remaining budget, not the original period limit', async () => {
    const t = setup(); const r = review();
    r.hardStop.configuredLimitUsd = '100'; r.hardStop.reportedSpendUsd = '99.5'; r.hardStop.remainingBudgetUsd = '0.5';
    t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, r);
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('ready');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('passed');
    expect(t.stored().remainingBudgetUsd).toBe('0.5');
  });
  it('does not substitute speculative all-charge or in-flight attestations for the actual hard_stop setting', async () => {
    const t = setup(); const r = review();
    t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, { ...r, hardStop: { ...r.hardStop, hard_stop: undefined, includesAllCharges: true, includesInFlightCharges: true } });
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_budget_review'); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it('does not require prior live credential success, quality approvals, discovery or builder activation', async () => {
    const t = setup();
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('passed');
    expect(t.docs.has('live_ai_registry/surplus-builder-reviews')).toBe(false);
    expect(t.env.AGENTV3_SURPLUS_BUILDER).toBe('false'); expect(t.env.SURPLUS_REGISTRY_ENABLED).toBe('off');
  });
  it('fails closed without durable database availability', async () => {
    const t = setup(); t.deps.db = null;
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('unavailable');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unavailable');
    expect(t.fetcher).not.toHaveBeenCalled();
    t.deps.db = t.db as never; t.options.unavailable = true;
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unavailable'); expect(t.fetcher).not.toHaveBeenCalled();
  });
});

describe('fixed, bounded, durable one-shot dispatch', () => {
  it('sends only one fixed synthetic request using the existing runtime Standard key', async () => {
    const t = setup(); Object.assign(t.env, { SURPLUS_BASE_URL: 'https://hostile.example', SURPLUS_MODEL: 'hostile-model', OPENAI_CUSTOM_HEADERS: 'secret' });
    const result = await runSurplusConnectionTest(t.deps);
    expect(result).toMatchObject({ status: 'passed', expectedResponse: 'matched', actualCostUsd: '0.000029', latencyMs: 0 });
    expect(t.fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.surplusintelligence.ai/min90/v1/chat/completions');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
    expect(JSON.parse(init.body as string)).toEqual({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'Reply with exactly OK and nothing else.' }], max_tokens: 32, stream: false, si_route: { objective: 'price' } });
    expect(t.stored()).toMatchObject({ attempts: 1, state: 'reported', authorizationId: SURPLUS_CONNECTION_TEST_AUTHORITY, remainingBudgetUsd: '1' });
    expect(JSON.stringify([...t.docs.values()])).not.toContain(KEY);
    expect([...t.docs.keys()].every(path => [SURPLUS_CONNECTION_TEST_DOCUMENT, SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT].includes(path))).toBe(true);
  });
  it('reserves before network and deduplicates concurrent calls across instances', async () => {
    const t = setup(); let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    t.fetcher.mockImplementation(async () => { expect(t.stored().state).toBe('unknown_liability_hold'); await gate; return new Response(JSON.stringify(wire())); });
    const first = runSurplusConnectionTest(t.deps);
    await vi.waitFor(() => expect(t.fetcher).toHaveBeenCalledTimes(1));
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => runSurplusConnectionTest({ ...t.deps })));
    expect(duplicates.every(value => value.status === 'unknown_liability_hold')).toBe(true);
    finish(); expect((await first).status).toBe('passed');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('passed'); expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not rearm through review, credential, account, configuration, or time changes', async () => {
    const t = setup(); await runSurplusConnectionTest(t.deps);
    t.env.SURPLUS_API_KEY = 'inf_rotated_key'; t.env.AGENTV3_SURPLUS_BUILDER = 'on';
    t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, { ...review(), revision: 2, accountId: 'new', credentialSha256: sha(t.env.SURPLUS_API_KEY) });
    t.deps.now = () => NOW + 999_999_999;
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('passed');
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('passed'); expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it('never treats malformed or legacy retained evidence as a fresh unattempted gate', async () => {
    const t = setup(); t.docs.set(SURPLUS_CONNECTION_TEST_DOCUMENT, { status: 'ready' });
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold'); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it('does not dispatch when an uncertain commit acknowledgement may already have consumed the gate', async () => {
    const t = setup(); t.options.uncertainCommit = true;
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unavailable'); expect(t.stored().attempts).toBe(1);
    t.options.uncertainCommit = false;
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold'); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it('retains a hold if result persistence fails after the potentially billed request', async () => {
    const t = setup(); t.options.failFinalWrite = true;
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
    t.options.failFinalWrite = false;
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold'); expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['review', 'credential', 'flags'])('rechecks %s after reservation and never frees the consumed gate', async change => {
    const t = setup(); t.options.afterReservation = () => {
      if (change === 'review') t.docs.delete(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT);
      if (change === 'credential') t.env.SURPLUS_API_KEY = 'inf_changed';
      if (change === 'flags') t.env.SURPLUS_REGISTRY_ENABLED = 'true';
    };
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored().attempts).toBe(1);
  });
  it.each(['key', 'flags'])('rechecks %s after the asynchronous final review read and before dispatch', async change => {
    const t = setup();
    t.options.onRead = async path => {
      if (path !== SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT) return;
      await Promise.resolve();
      if (change === 'key') t.env.SURPLUS_API_KEY = 'inf_changed_during_review';
      else t.env.AGENTV3_SURPLUS_BUILDER = 'on';
    };
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored().attempts).toBe(1);
  });
  it('bounds network time and never retries on timeout', async () => {
    vi.useFakeTimers(); const t = setup();
    t.deps.fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('raw token secret'))); })) as typeof fetch;
    const pending = runSurplusConnectionTest(t.deps); await vi.advanceTimersByTimeAsync(60_001);
    expect((await pending).status).toBe('unknown_liability_hold');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold'); expect(t.deps.fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('exact cost and safe expected-response projection', () => {
  it.each([
    ['0', '0'], ['1000', '0.001'], ['1000000', '1'], ['9007199254740993', '9007199254.740993'],
  ])('preserves exact integer microUSD %s as %s without floating-point rounding', async (raw, expected) => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire()).replace('"buyer_cost_micro":29', `"buyer_cost_micro":${raw}`)));
    const out = await runSurplusConnectionTest(t.deps);
    expect(out.actualCostUsd).toBe(expected); expect(out.status).toBe(BigInt(raw) > 1_000_000n ? 'budget_exceeded' : 'passed');
    expect(await getSurplusConnectionTestStatus(t.deps)).toEqual(out);
  });
  it.each(['1.0000000000000000001', '-1', '1e3', '1000000000000000000', 'null', 'true', '""'])('never guesses a canonical cost from %s', async raw => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire()).replace('"buyer_cost_micro":29', `"buyer_cost_micro":${raw}`)));
    expect(await runSurplusConnectionTest(t.deps)).toMatchObject({ status: 'unknown_liability_hold', actualCostUsd: null });
  });
  it('accepts provider integer microUSD strings and removes canonical trailing zeros', async () => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire({ usage: { buyer_cost_micro: '123000' } }))));
    expect((await runSurplusConnectionTest(t.deps)).actualCostUsd).toBe('0.123');
  });
  it.each([
    wire({ usage: {} }), { error: { message: 'raw-secret-error' } }, { data: { usage: { buyer_cost_micro: 0 } } },
  ])('holds unknown liabilities when complete bound cost evidence is absent', async body => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(body)));
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold'); expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    '{"usage":{"buyer_cost_micro":0},"usage":{"buyer_cost_micro":29}}',
    JSON.stringify(wire()).replace('"buyer_cost_micro":29', '"buyer_cost_micro":0,"buyer_cost_micro":29'),
    '{invalid}', '[]', 'null', '{"a":'.repeat(40) + '0' + '}'.repeat(40),
  ])('rejects malformed, duplicate or excessively nested JSON without leaking body', async body => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(body));
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
  });
  it.each([401, 403, 429, 500, 302])('does not infer a free or retryable attempt from HTTP %s', async status => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response('{"error":"raw secret"}', { status }));
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold'); expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['wrong response and confidential text', 'okay', 'OK extra'])('records mismatch, not raw model text: %s', async content => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }))));
    expect(await runSurplusConnectionTest(t.deps)).toMatchObject({ status: 'failed', expectedResponse: 'mismatched', actualCostUsd: '0.000029' });
    expect(JSON.stringify(t.stored())).not.toContain(content);
  });
  it('does not call tool output, truncation or missing assistant structure a passed connection test', async () => {
    for (const choice of [
      { finish_reason: 'length', message: { role: 'assistant', content: 'OK' } },
      { finish_reason: 'stop', message: { role: 'assistant', content: 'OK', tool_calls: [{ secret: 'private' }] } },
      { finish_reason: 'stop', message: { role: 'user', content: 'OK' } },
    ]) {
      const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire({ choices: [choice] }))));
      expect(await runSurplusConnectionTest(t.deps)).toMatchObject({ status: 'failed', expectedResponse: 'not_checked' });
    }
  });
  it.each([false, true])('enforces body byte bound with and without content-length: %s', async withLength => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response('x'.repeat(65_537), { headers: withLength ? { 'content-length': '65537' } : {} }));
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
  });
  it.each([400, 401, 403, 429, 500])('retains canonical supplier cost on HTTP %s errors without claiming output success', async status => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'raw secret error' }, usage: { buyer_cost_micro: 123 } }), { status }));
    expect(await runSurplusConnectionTest(t.deps)).toMatchObject({ status: 'failed', actualCostUsd: '0.000123', expectedResponse: 'not_checked' });
    expect((await getSurplusConnectionTestStatus(t.deps)).actualCostUsd).toBe('0.000123');
    expect(JSON.stringify(t.stored())).not.toContain('raw secret error');
    await runSurplusConnectionTest(t.deps); expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([wire({ model: 'different' }), wire({ id: '' }), wire({ error: 'failed' }), wire({ data: {} })])('separates canonical expense from failed identity/output validation', async body => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(body)));
    expect(await runSurplusConnectionTest(t.deps)).toMatchObject({ status: 'failed', actualCostUsd: '0.000029', expectedResponse: 'not_checked' });
  });
  it('preserves documented header expense when the response body is missing or malformed', async () => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response('malformed raw output', { status: 500, headers: { 'x-si-buyer-cost-micro': '123456' } }));
    expect(await runSurplusConnectionTest(t.deps)).toMatchObject({ status: 'failed', actualCostUsd: '0.123456', expectedResponse: 'not_checked' });
  });
  it.each(['30', 'not-an-integer'])('holds conflicting/invalid canonical header cost %s instead of choosing an amount', async header => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire()), { headers: { 'x-si-buyer-cost-micro': header } }));
    expect(await runSurplusConnectionTest(t.deps)).toMatchObject({ status: 'unknown_liability_hold', actualCostUsd: null });
  });
  it('reports a violated reviewed limit even when the amount remains below the overall $1 authorization', async () => {
    const t = setup(); const r = review(); r.hardStop.configuredLimitUsd = '0.5'; r.hardStop.remainingBudgetUsd = '0.5'; t.docs.set(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT, r);
    t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire({ usage: { buyer_cost_micro: 750000 } }))));
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('budget_exceeded');
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('budget_exceeded');
  });
  it('contains no wallet writers, builder/metadata calls, credential creation or approval seeding', () => {
    const source = readFileSync('src/server/AI/SurplusRegistry/connectionTest.ts', 'utf8');
    expect(source).not.toMatch(/console\.|createSurplusChat\(|createSurplusBuildTransport\(|reserveSurplusAttempt\(|refreshSurplusRegistry\(|recordProviderCost\(|user_token_wallets|\/buyer\/keys/);
    expect(source).not.toMatch(/\.set\([^\n]*SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT/);
    expect(source).not.toContain('process.env.AGENTV3_SURPLUS_BUILDER =');
    expect(source).not.toContain('process.env.SURPLUS_REGISTRY_ENABLED =');
  });
});

describe('non-inference credential authentication check', () => {
  it('checks only the fixed buyer/me endpoint without reading or retaining private account body', async () => {
    const t = setup(); t.docs.clear();
    const cancel = vi.fn(async () => {}), read = vi.fn(() => { throw new Error('private body must not be read'); });
    t.fetcher.mockResolvedValue({ status: 200, redirected: false, headers: new Headers({ 'content-type': 'application/json' }), body: { cancel, getReader: read } } as unknown as Response);
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: 'accepted' });
    const [url, init] = t.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.surplusintelligence.ai/v1/buyer/me');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } });
    expect(init.body).toBeUndefined(); expect(cancel).toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(t.docs.size).toBe(0);
  });
  it.each([[200, 'accepted'], [401, 'rejected'], [403, 'unavailable'], [429, 'unavailable'], [500, 'unavailable'], [302, 'unavailable']])('maps HTTP %s to only %s', async (status, expected) => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response('raw account wallet balance private body', { status: status as number, headers: { 'content-type': 'application/json' } }));
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: expected });
    expect(t.stored()).toBeUndefined();
  });
  it.each(['text/html', 'text/plain', ''])('does not mistake HTTP200 %s for the documented authenticated JSON endpoint', async contentType => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response('<html>Sign in or WAF challenge</html>', { headers: { 'content-type': contentType } }));
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: 'unavailable' });
  });
  it('does not require database, hard-stop, coding approval, or prior authentication', async () => {
    const t = setup(); t.deps.db = null;
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: 'accepted' }); expect(t.stored()).toBeUndefined();
  });
  it.each([{ SURPLUS_API_KEY: 'inf_admin_secret' }, { AGENTV3_SURPLUS_BUILDER: 'on' }, { SURPLUS_REGISTRY_ENABLED: undefined }])('rejects unsupported configuration %j with no network call', async change => {
    const t = setup(); Object.assign(t.env, change);
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: 'unavailable' }); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it('uses a bounded timeout and never retries or discloses upstream errors', async () => {
    vi.useFakeTimers(); const t = setup();
    t.deps.fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error(KEY))); })) as typeof fetch;
    const pending = runSurplusCredentialCheck(t.deps); await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ status: 'unavailable' }); expect(t.deps.fetcher).toHaveBeenCalledTimes(1);
  });
});
