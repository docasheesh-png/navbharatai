import { describe, expect, it } from 'vitest';
import { reserveSurplusAttempt, persistSurplusReceipt, resolveSurplusUnattempted, type SurplusReceiptAudit, type SurplusUnattemptedAudit } from './receiptStore';
const now = 1800000000000;
function setup() {
  const pilot = { id: 'authorized-pilot', expiresAt: now + 10000, maxCalls: 2, maxEstimatedMicroUsd: '100', providerSpendLimitReviewedUntil: now + 10000, noAutoTopup: true as const };
  const input = { buildId: 'build', callId: 'call', accountId: 'account', credentialSha256: 'a'.repeat(64), model: 'model', providerId: 'provider', endpoint: 'min90', policyVersion: 'policy', priceGeneration: 'generation', estimatedMicroUsd: '30', reviewRevision: 1, pilot, now };
  const docs = new Map<string, any>([['live_ai_registry/surplus-builder-reviews', { revision: 1, account: { accountId: input.accountId, credentialSha256: input.credentialSha256, reviewedUntil: now + 10000 }, pilot }]]);
  let queue = Promise.resolve();
  const db = { doc: (path: string) => ({ path }), runTransaction: (fn: (tx: any) => Promise<any>) => {
    const run = queue.then(async () => { const writes = new Map<string, any>(); const result = await fn({ get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }), set: (ref: { path: string }, value: unknown) => writes.set(ref.path, structuredClone(value)) }); for (const [k,v] of writes) docs.set(k,v); return result; });
    queue = run.catch(() => {}); return run;
  } };
  const audit = (actualCostUsd: string | null = '0.00002', status = 'chargeable'): SurplusReceiptAudit => ({ buildId: input.buildId, callId: input.callId, accountId: input.accountId, model: input.model, providerId: input.providerId, endpoint: input.endpoint, policyVersion: input.policyVersion, priceGeneration: input.priceGeneration, reportedAt: now + 1, usage: null, invoiceReconciliation: 'not-reconciled', decision: { actualCostUsd, officialCeilingUsd: '0.0002', userChargeUsd: '0.0002', evidenceFingerprint: 'fingerprint', status } as never });
  const unattempted = (reason: SurplusUnattemptedAudit['reason'] = 'minimum_discount_not_met'): SurplusUnattemptedAudit => ({
    buildId: input.buildId, callId: input.callId, accountId: input.accountId, model: input.model, providerId: input.providerId,
    endpoint: input.endpoint, policyVersion: input.policyVersion, priceGeneration: input.priceGeneration,
    reportedAt: now + 1, reason, traceRequestId: 'official-trace-123', evidenceSha256: 'b'.repeat(64),
  });
  const pilotState = () => [...docs.entries()].find(([key]) => key.startsWith('surplus_pilot_admissions/'))![1];
  const receiptState = () => [...docs.entries()].find(([key]) => key.startsWith('surplus_build_receipts/'))![1];
  return { db: db as never, docs, input, audit, unattempted, pilotState, receiptState };
}
describe('durable Surplus pilot reservations', () => {
  it('requires explicit reviewed pilot budget and current revision', async () => {
    const { db,input } = setup();
    await expect(reserveSurplusAttempt(db, { ...input, pilot: { ...input.pilot, maxCalls: 0 } })).rejects.toThrow();
    await expect(reserveSurplusAttempt(db, { ...input, reviewRevision: 2 })).rejects.toThrow('revoked');
  });
  it('concurrent callers cannot reserve the same pending budget twice', async () => {
    const { db,input,docs } = setup();
    const results = await Promise.allSettled([reserveSurplusAttempt(db,input),reserveSurplusAttempt(db,{...input,callId:'second',buildId:'another-app'})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect([...docs.values()].filter(d=>d.state==='pending')).toHaveLength(1);
  });
  it('uncertain requests retain the reservation, including across new app builds', async () => {
    const { db,input } = setup(); await reserveSurplusAttempt(db,input);
    await expect(reserveSurplusAttempt(db,{...input,callId:'retry',buildId:'new-build'})).rejects.toThrow('pending');
    await expect(reserveSurplusAttempt(db,input)).rejects.toThrow('already reserved');
  });
  it('known actual replaces estimated reservation but never refunds a supplier expense', async () => {
    const { db,input,audit,docs } = setup(); await reserveSurplusAttempt(db,input); await persistSurplusReceipt(db,audit());
    const state = [...docs.entries()].find(([k])=>k.startsWith('surplus_pilot_admissions/'))![1];
    expect(state).toMatchObject({actualMicroUsd:'20',pendingCallId:null,reservedEstimatedMicroUsd:'0'});
    await reserveSurplusAttempt(db,{...input,callId:'call-2',buildId:'build-2'});
  });
  it('actual over estimate consumes budget and blocks another call', async () => {
    const { db,input,audit } = setup(); await reserveSurplusAttempt(db,input); await persistSurplusReceipt(db,audit('0.000099'));
    await expect(reserveSurplusAttempt(db,{...input,callId:'another'})).rejects.toThrow('blocked');
  });
  it('unknown cost or unbillable receipt quarantines later dispatch', async () => {
    for (const actual of [null,'0.00002']) {
      const { db,input,audit } = setup(); await reserveSurplusAttempt(db,input); await persistSurplusReceipt(db,audit(actual,'blocked'));
      await expect(reserveSurplusAttempt(db,{...input,callId:'another'})).rejects.toThrow();
    }
  });
  it('checks revocation in the transaction, not only before it', async () => {
    const { db,input,docs } = setup(); docs.get('live_ai_registry/surplus-builder-reviews').revision = 2;
    await expect(reserveSurplusAttempt(db,input)).rejects.toThrow('revoked');
    expect([...docs.keys()].filter(k=>k.startsWith('surplus_build_receipts/'))).toHaveLength(0);
  });
  it('deduplicates exact receipt callbacks and refuses changed evidence', async () => {
    const { db,input,audit,docs } = setup(); await reserveSurplusAttempt(db,input); await persistSurplusReceipt(db,audit()); await persistSurplusReceipt(db,audit());
    expect([...docs.values()].find(d=>d.actualMicroUsd)?.actualMicroUsd).toBe('20');
    const bad=audit();bad.decision={...bad.decision,evidenceFingerprint:'changed'};
    await expect(persistSurplusReceipt(db,bad)).rejects.toThrow('conflict');
  });
  it('permits only a same-evidence correction to whole-call absorption', async () => {
    const { db,input,audit } = setup(); await reserveSurplusAttempt(db,input); await persistSurplusReceipt(db,audit());
    const absorbed=audit();absorbed.decision={...absorbed.decision,status:'absorbed',userChargeUsd:'0'};
    await expect(persistSurplusReceipt(db,absorbed)).resolves.toEqual({canContinue:true});
  });
  it.each([{ calls: -1 }, { calls: '2' }, { calls: NaN }, { actualMicroUsd: '-1' }, { actualMicroUsd: 'NaN' }, { blocked: 'false' }])('rejects corrupted persisted authority %j', async change => {
    const { db,input,audit,docs } = setup(); await reserveSurplusAttempt(db,input); await persistSurplusReceipt(db,audit());
    const key = [...docs.keys()].find(k=>k.startsWith('surplus_pilot_admissions/'))!;
    docs.set(key,{...docs.get(key),...change});
    await expect(reserveSurplusAttempt(db,{...input,callId:'next'})).rejects.toThrow('state invalid');
  });
  it('rejects a final receipt belonging to another build', async () => {
    const { db,input,audit } = setup(); await reserveSurplusAttempt(db,input);
    await expect(persistSurplusReceipt(db,{...audit(),buildId:'other'})).rejects.toThrow('identity mismatch');
  });

  it.each([
    ['over estimate', '0.000031', '0.001', 'actual_cost_exceeded_reserved_estimate'],
    ['below90%', '0.000021', '0.0002', 'realized_discount_below_90_percent'],
    ['above official tariff', '0.00002', '0.00001', 'realized_discount_below_90_percent'],
    ['missing official comparison', '0.00002', null, 'official_tariff_comparison_unavailable'],
  ])('quarantines %s without rewriting actual expense or approved user charge', async (_label, actual, official, reason) => {
    const { db,input,audit,docs } = setup(); await reserveSurplusAttempt(db,input);
    const receipt = audit(actual); receipt.decision = { ...receipt.decision, officialCeilingUsd: official };
    await persistSurplusReceipt(db,receipt);
    const pilot = [...docs.entries()].find(([key])=>key.startsWith('surplus_pilot_admissions/'))![1];
    const stored = [...docs.entries()].find(([key])=>key.startsWith('surplus_build_receipts/'))![1];
    expect(pilot).toMatchObject({ blocked:true, quarantineReason:reason, pendingCallId:null });
    expect(stored.decision).toEqual(receipt.decision);
    expect(stored.quarantineReason).toBe(reason);
    await expect(reserveSurplusAttempt(db,{...input,callId:'next'})).rejects.toThrow('blocked');
    // Another server process reads the persisted fence, not an in-memory poisoned session.
    const restarted = setup(); restarted.docs.clear();
    for (const [key,value] of docs) restarted.docs.set(key,structuredClone(value));
    await expect(reserveSurplusAttempt(restarted.db,{...input,callId:'restart-next'})).rejects.toThrow('blocked');
  });
  it('exactly90% and exact reservation are allowed without rounding the official ceiling', async () => {
    const { db,input,audit,docs } = setup(); await reserveSurplusAttempt(db,{...input,estimatedMicroUsd:'20'});
    await persistSurplusReceipt(db,audit());
    expect([...docs.values()].find(value=>value.actualMicroUsd)?.blocked).toBe(false);
    await expect(reserveSurplusAttempt(db,{...input,callId:'next'})).resolves.toBeUndefined();
  });
  it('a pending concurrent call is refused, then reconciled quarantine survives duplicate and Stop correction', async () => {
    const { db,input,audit,docs } = setup(); await reserveSurplusAttempt(db,input);
    await expect(reserveSurplusAttempt(db,{...input,callId:'parallel'})).rejects.toThrow('pending');
    const receipt = audit('0.000031'); await persistSurplusReceipt(db,receipt); await persistSurplusReceipt(db,receipt);
    await persistSurplusReceipt(db,{...receipt,decision:{...receipt.decision,status:'absorbed',userChargeUsd:'0'}});
    expect([...docs.values()].find(value=>value.actualMicroUsd)).toMatchObject({ actualMicroUsd:'31',blocked:true,quarantineReason:'actual_cost_exceeded_reserved_estimate' });
    await expect(reserveSurplusAttempt(db,{...input,callId:'after-stop'})).rejects.toThrow('blocked');
  });

  it('valid wholly absorbed repair with verified90% savings can continue without charging the user', async () => {
    const { db,input,audit,docs } = setup(); await reserveSurplusAttempt(db,input);
    const receipt = audit('0.00002','absorbed'); receipt.decision = {...receipt.decision,userChargeUsd:'0'};
    await persistSurplusReceipt(db,receipt);
    expect([...docs.values()].find(value=>value.actualMicroUsd)).toMatchObject({actualMicroUsd:'20',blocked:false,quarantineReason:null});
    expect([...docs.values()].find(value=>value.decision)?.decision.userChargeUsd).toBe('0');
    await expect(reserveSurplusAttempt(db,{...input,callId:'repair-next'})).resolves.toBeUndefined();
  });

});


describe('durable explicitly unattempted Surplus resolutions', () => {
  it.each(['minimum_discount_not_met', 'no_sellers_for_model'] as const)('resolves %s without manufacturing a receipt, refund or free extra attempt', async reason => {
    const { db, input, unattempted, pilotState, receiptState, docs } = setup();
    await reserveSurplusAttempt(db, input);
    expect(await resolveSurplusUnattempted(db, unattempted(reason))).toEqual({ canContinue: true });
    expect(pilotState()).toMatchObject({ calls: 1, actualMicroUsd: '0', pendingCallId: null, reservedEstimatedMicroUsd: '0' });
    expect(receiptState()).toMatchObject({ state: 'not_attempted', reason, traceRequestId: 'official-trace-123', evidenceSha256: 'b'.repeat(64) });
    expect(receiptState()).not.toHaveProperty('decision');
    expect(receiptState()).not.toHaveProperty('actualCostUsd');
    expect([...docs.keys()].some(key => key.includes('ledger'))).toBe(false);
    await expect(reserveSurplusAttempt(db, input)).rejects.toThrow('already reserved');
    await reserveSurplusAttempt(db, { ...input, callId: 'fallback' });
    await resolveSurplusUnattempted(db, { ...unattempted(reason), callId: 'fallback' });
    expect(pilotState().calls).toBe(2);
    await expect(reserveSurplusAttempt(db, { ...input, callId: 'third' })).rejects.toThrow('exhausted');
  });
  it('retains earlier supplier expense instead of treating no attempt as a refund', async () => {
    const { db, input, audit, unattempted, pilotState } = setup();
    await reserveSurplusAttempt(db, input); await persistSurplusReceipt(db, audit());
    await reserveSurplusAttempt(db, { ...input, callId: 'fallback' });
    await resolveSurplusUnattempted(db, { ...unattempted(), callId: 'fallback' });
    expect(pilotState()).toMatchObject({ calls: 2, actualMicroUsd: '20', pendingCallId: null });
  });
  it('deduplicates identical resolutions including concurrent callbacks', async () => {
    const { db, input, unattempted, pilotState, receiptState } = setup();
    await reserveSurplusAttempt(db, input);
    const results = await Promise.all([resolveSurplusUnattempted(db, unattempted()), resolveSurplusUnattempted(db, { ...unattempted(), reportedAt: now + 2 })]);
    expect(results).toEqual([{ canContinue: true }, { canContinue: true }]);
    expect(pilotState().calls).toBe(1);
    expect(receiptState().reportedAt).toBe(now + 1);
  });
  it('does not clear a later pending call on replay and reports that continuation is blocked', async () => {
    const { db, input, unattempted, pilotState } = setup();
    await reserveSurplusAttempt(db, input); await resolveSurplusUnattempted(db, unattempted());
    await reserveSurplusAttempt(db, { ...input, callId: 'next' });
    expect(await resolveSurplusUnattempted(db, unattempted())).toEqual({ canContinue: false });
    expect(pilotState()).toMatchObject({ calls: 2, pendingCallId: 'next', reservedEstimatedMicroUsd: '30' });
  });
  it.each([
    { reason: 'receipt_not_found' }, { reason: 'zero_cost' }, { reason: 'timeout' }, { reason: '404' },
    { traceRequestId: '' }, { traceRequestId: ' trace ' }, { traceRequestId: 'trace\n' },
    { evidenceSha256: '' }, { evidenceSha256: 'generic-zero' }, { reportedAt: NaN },
  ])('rejects missing or non-specific no-attempt evidence %j without releasing reservation', async change => {
    const { db, input, unattempted, pilotState, receiptState } = setup();
    await reserveSurplusAttempt(db, input);
    await expect(resolveSurplusUnattempted(db, { ...unattempted(), ...change } as SurplusUnattemptedAudit)).rejects.toThrow('evidence invalid');
    expect(pilotState().pendingCallId).toBe(input.callId);
    expect(receiptState().state).toBe('pending');
  });
  it.each(['buildId', 'model', 'providerId', 'endpoint', 'policyVersion', 'priceGeneration'] as const)('binds reservation %s', async key => {
    const { db, input, unattempted, pilotState } = setup();
    await reserveSurplusAttempt(db, input);
    await expect(resolveSurplusUnattempted(db, { ...unattempted(), [key]: 'different' })).rejects.toThrow('identity mismatch');
    expect(pilotState().pendingCallId).toBe(input.callId);
  });
  it.each(['callId', 'accountId'] as const)('cannot resolve an unreserved %s', async key => {
    const { db, input, unattempted, pilotState } = setup();
    await reserveSurplusAttempt(db, input);
    await expect(resolveSurplusUnattempted(db, { ...unattempted(), [key]: 'different' })).rejects.toThrow('no durable dispatch reservation');
    expect(pilotState().pendingCallId).toBe(input.callId);
  });
  it.each([{ reason: 'no_sellers_for_model' }, { traceRequestId: 'different' }, { evidenceSha256: 'c'.repeat(64) }])('rejects conflicting resolution evidence %j', async change => {
    const { db, input, unattempted, receiptState } = setup();
    await reserveSurplusAttempt(db, input); await resolveSurplusUnattempted(db, unattempted());
    await expect(resolveSurplusUnattempted(db, { ...unattempted(), ...change } as SurplusUnattemptedAudit)).rejects.toThrow('conflict');
    expect(receiptState()).toMatchObject({ state: 'not_attempted', reason: 'minimum_discount_not_met', traceRequestId: 'official-trace-123', evidenceSha256: 'b'.repeat(64) });
  });
  it('rejects a request to rewrite a supplier receipt as not attempted', async () => {
    const { db, input, audit, unattempted, pilotState, receiptState } = setup();
    await reserveSurplusAttempt(db, input); await persistSurplusReceipt(db, audit());
    await expect(resolveSurplusUnattempted(db, unattempted())).rejects.toThrow('conflicts with receipt');
    expect(receiptState().state).toBe('reported'); expect(pilotState().actualMicroUsd).toBe('20');
  });
  it('rejects a supplier receipt conflicting with a not-attempted resolution', async () => {
    const { db, input, audit, unattempted, pilotState, receiptState } = setup();
    await reserveSurplusAttempt(db, input); await resolveSurplusUnattempted(db, unattempted());
    await expect(persistSurplusReceipt(db, audit())).rejects.toThrow('conflict');
    expect(receiptState().state).toBe('not_attempted'); expect(pilotState().actualMicroUsd).toBe('0');
  });
  it.each([null, '0'])('never recasts an uncertain or generic-zero receipt (%s) as not attempted', async actual => {
    const { db, input, audit, unattempted, pilotState } = setup();
    await reserveSurplusAttempt(db, input);
    expect(await persistSurplusReceipt(db, audit(actual, 'blocked'))).toEqual({ canContinue: false });
    await expect(resolveSurplusUnattempted(db, unattempted())).rejects.toThrow('conflicts with receipt');
    expect(pilotState().blocked).toBe(true);
  });
  it('keeps quarantine through resolution and replay, including a persisted reason without a blocked flag', async () => {
    for (const blocked of [true, false]) {
      const { db, input, unattempted, pilotState, receiptState } = setup();
      await reserveSurplusAttempt(db, input);
      Object.assign(pilotState(), { blocked, quarantineReason: 'supplier_cost_unknown', quarantinedAt: now });
      expect(await resolveSurplusUnattempted(db, unattempted())).toEqual({ canContinue: false });
      expect(await resolveSurplusUnattempted(db, unattempted())).toEqual({ canContinue: false });
      expect(pilotState()).toMatchObject({ blocked, quarantineReason: 'supplier_cost_unknown', quarantinedAt: now, pendingCallId: null });
      expect(receiptState().state).toBe('not_attempted');
      await expect(reserveSurplusAttempt(db, { ...input, callId: 'next' })).rejects.toThrow('blocked');
    }
  });
  it('retains a timestamp-only quarantine fence instead of interpreting a missing reason as recovery', async () => {
    const { db, input, unattempted, pilotState } = setup(); await reserveSurplusAttempt(db, input);
    Object.assign(pilotState(), { blocked: false, quarantineReason: null, quarantinedAt: now });
    expect(await resolveSurplusUnattempted(db, unattempted())).toEqual({ canContinue: false });
    expect(pilotState().quarantinedAt).toBe(now);
    await expect(reserveSurplusAttempt(db, { ...input, callId: 'next' })).rejects.toThrow('blocked');
  });
  it('does not erase a malformed existing receipt field', async () => {
    const { db, input, unattempted, receiptState, pilotState } = setup(); await reserveSurplusAttempt(db, input);
    receiptState().decision = null;
    await expect(resolveSurplusUnattempted(db, unattempted())).rejects.toThrow('conflicts with receipt');
    expect(pilotState().pendingCallId).toBe(input.callId);
  });
  it('cannot clear a mismatched pending reservation', async () => {
    const { db, input, unattempted, pilotState, receiptState } = setup();
    await reserveSurplusAttempt(db, input); pilotState().pendingCallId = 'other';
    await expect(resolveSurplusUnattempted(db, unattempted())).rejects.toThrow('reservation mismatch');
    expect(pilotState().pendingCallId).toBe('other'); expect(receiptState().state).toBe('pending');
  });
  it('rejects evidence older than the durable dispatch reservation', async () => {
    const { db, input, unattempted } = setup(); await reserveSurplusAttempt(db, input);
    await expect(resolveSurplusUnattempted(db, { ...unattempted(), reportedAt: now - 1 })).rejects.toThrow('predates reservation');
  });
  it.each([{ calls: 0 }, { actualMicroUsd: '-1' }, { reservedEstimatedMicroUsd: null }, { blocked: 'false' }, { authorityId: '' }, { expiresAt: null }, { quarantinedAt: 'yesterday' }])('fails closed for corrupt pilot state on resolution and replay %j', async change => {
    for (const replay of [false, true]) {
      const { db, input, unattempted, pilotState } = setup(); await reserveSurplusAttempt(db, input);
      if (replay) await resolveSurplusUnattempted(db, unattempted());
      Object.assign(pilotState(), change);
      await expect(resolveSurplusUnattempted(db, unattempted())).rejects.toThrow('state invalid');
    }
  });
});

describe('transaction-derived Surplus continuation result', () => {
  it('returns current persisted continuation for valid receipt and duplicate without duplicate expense', async () => {
    const { db, input, audit, pilotState } = setup(); await reserveSurplusAttempt(db, input);
    expect(await persistSurplusReceipt(db, audit())).toEqual({ canContinue: true });
    expect(await persistSurplusReceipt(db, audit())).toEqual({ canContinue: true });
    expect(pilotState().actualMicroUsd).toBe('20');
    await reserveSurplusAttempt(db, { ...input, callId: 'later' });
    expect(await persistSurplusReceipt(db, audit())).toEqual({ canContinue: false });
    expect(pilotState().pendingCallId).toBe('later');
  });
  it('returns false for quarantined initial receipt, duplicate and Stop correction', async () => {
    const { db, input, audit, pilotState } = setup(); await reserveSurplusAttempt(db, input);
    const receipt = audit('0.000031');
    expect(await persistSurplusReceipt(db, receipt)).toEqual({ canContinue: false });
    expect(await persistSurplusReceipt(db, receipt)).toEqual({ canContinue: false });
    expect(await persistSurplusReceipt(db, { ...receipt, decision: { ...receipt.decision, status: 'absorbed', userChargeUsd: '0' } })).toEqual({ canContinue: false });
    expect(pilotState()).toMatchObject({ actualMicroUsd: '31', blocked: true, quarantineReason: 'actual_cost_exceeded_reserved_estimate' });
  });
  it('correction can add quarantine but never changes the already-recorded supplier expense', async () => {
    const { db, input, audit, pilotState } = setup(); await reserveSurplusAttempt(db, input);
    await persistSurplusReceipt(db, audit());
    const corrected = audit(); corrected.decision = { ...corrected.decision, status: 'absorbed', userChargeUsd: '0', officialCeilingUsd: null };
    expect(await persistSurplusReceipt(db, corrected)).toEqual({ canContinue: false });
    expect(pilotState()).toMatchObject({ actualMicroUsd: '20', blocked: true, quarantineReason: 'official_tariff_comparison_unavailable' });
  });
  it('same fingerprint does not permit changing recorded supplier expense during absorption', async () => {
    const { db, input, audit, pilotState } = setup(); await reserveSurplusAttempt(db, input); await persistSurplusReceipt(db, audit());
    const corrected = audit('0'); corrected.decision = { ...corrected.decision, status: 'absorbed', userChargeUsd: '0' };
    await expect(persistSurplusReceipt(db, corrected)).rejects.toThrow('conflict');
    expect(pilotState().actualMicroUsd).toBe('20');
  });
  it('replays and corrections fail closed on invalid persisted pilot state', async () => {
    const { db, input, audit, pilotState } = setup(); await reserveSurplusAttempt(db, input); await persistSurplusReceipt(db, audit());
    pilotState().blocked = 'false';
    await expect(persistSurplusReceipt(db, audit())).rejects.toThrow('state invalid');
    const corrected = audit(); corrected.decision = { ...corrected.decision, status: 'absorbed', userChargeUsd: '0' };
    await expect(persistSurplusReceipt(db, corrected)).rejects.toThrow('state invalid');
  });
});

describe('transactional Surplus model manager fence', () => {
  const controls = { revision: 1, disabledModels: [] as string[], updatedAt: now, reason: 'Operator reviewed model availability' };
  it('permits legacy missing controls only at captured revision zero', async () => {
    const { db, input, docs } = setup(); docs.set('live_ai_registry/surplus-metadata', { snapshot: {} });
    await expect(reserveSurplusAttempt(db, { ...input, controlRevision: 1 })).rejects.toThrow('controls');
    await expect(reserveSurplusAttempt(db, { ...input, controlRevision: 0 })).resolves.toBeUndefined();
  });
  it('reads manager revision inside the reservation transaction, before dispatch', async () => {
    const { db, input, docs } = setup(); docs.set('live_ai_registry/surplus-metadata', { controls });
    await expect(reserveSurplusAttempt(db, input)).rejects.toThrow('controls');
    expect([...docs.keys()].some(key => key.startsWith('surplus_build_receipts/'))).toBe(false);
    await expect(reserveSurplusAttempt(db, { ...input, controlRevision: 1 })).resolves.toBeUndefined();
  });
  it('rejects an explicitly disabled model even when captured revision matches', async () => {
    const { db, input, docs } = setup(); docs.set('live_ai_registry/surplus-metadata', { controls: { ...controls, disabledModels: [input.model] } });
    await expect(reserveSurplusAttempt(db, { ...input, controlRevision: 1 })).rejects.toThrow('controls');
    expect([...docs.keys()].some(key => key.startsWith('surplus_build_receipts/'))).toBe(false);
  });
  it.each([{}, null, { ...controls, revision: -1 }, { ...controls, disabledModels: 'model' }, { ...controls, disabledModels: [false] }, { ...controls, disabledModels: ['model', 'model'] }])('fails closed for malformed manager controls %j', async invalid => {
    const { db, input, docs } = setup(); docs.set('live_ai_registry/surplus-metadata', { controls: invalid });
    await expect(reserveSurplusAttempt(db, { ...input, controlRevision: 1 })).rejects.toThrow('controls');
  });
  it.each([-1, NaN, 1.5])('rejects invalid captured revision %s', async controlRevision => {
    const { db, input } = setup(); await expect(reserveSurplusAttempt(db, { ...input, controlRevision })).rejects.toThrow('control revision');
  });
});
