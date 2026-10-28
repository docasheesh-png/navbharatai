import { describe, it, expect, vi } from 'vitest';
import { readSurplusPilotStatus } from './pilotStatus';
import { livePilotIdentity, synthesizeLiveReviews } from './liveAdmission';
import { surplusReceiptDigest } from './receiptStore';
import { isSurplusPilotStatus } from '../../../shared/surplusPilotStatus';
const env = { SURPLUS_API_KEY: 'private-credential', AGENTV3_SURPLUS_BUILDER: 'on' };
const identity = livePilotIdentity(env)!;
const valid = { authorityId: identity.pilotId, actualMicroUsd: '9220000', calls: 3, pendingCallId: 'private-call',
  reservedEstimatedMicroUsd: '12000', expiresAt: 1234, blocked: true, quarantineReason: 'supplier_cost_unknown', quarantinedAt: 123 };
function setup(state: unknown = valid, exists = true) {
  const get = vi.fn().mockResolvedValue({ exists, data: () => state });
  const doc = vi.fn(() => ({ get }));
  return { get, doc, read: () => readSurplusPilotStatus(env, () => ({ doc }) as never) };
}
describe('read-only actual production pilot projection', () => {
  it('shares the production identity and reads exactly one document without scanning receipts', async () => {
    const { doc, get, read } = setup(); const view = await read();
    const live = synthesizeLiveReviews(env, null, 1000);
    expect(identity.accountId).toBe(live.account.accountId); expect(identity.credentialSha256).toBe(live.account.credentialSha256);
    expect(identity.pilotId).toBe(live.pilot.id);
    expect(doc).toHaveBeenCalledExactlyOnceWith(`surplus_pilot_admissions/${surplusReceiptDigest([identity.accountId, identity.credentialSha256, identity.pilotId])}`);
    expect(get).toHaveBeenCalledOnce(); expect(isSurplusPilotStatus(view)).toBe(true);
    expect(view).toMatchObject({ status: 'recorded', pending: true, blocked: true, quarantined: true, reason: 'supplier_cost_unknown', calls: 3, recordedExpenseMicroUsd: '9220000', canDispatch: false });
    for (const secret of ['private', identity.accountId, identity.pilotId, identity.credentialSha256, 'surplus_pilot_admissions']) expect(JSON.stringify(view)).not.toContain(secret);
  });
  it('distinguishes absent records from failed reads without inventing zero liability', async () => {
    expect(await setup(undefined, false).read()).toMatchObject({ status: 'no_record', calls: null, pending: null, recordedExpenseMicroUsd: null });
    const s = setup(); s.get.mockRejectedValue(new Error('private-path'));
    expect(await s.read()).toMatchObject({ status: 'unknown', pending: null });
    expect(await readSurplusPilotStatus(env, () => null)).toMatchObject({ status: 'unknown' });
    const db = vi.fn(); expect(await readSurplusPilotStatus({}, db)).toMatchObject({ status: 'unknown', maxCalls: null }); expect(db).not.toHaveBeenCalled();
  });
  it.each([{ calls: -1 }, { calls: NaN }, { pendingCallId: undefined }, { actualMicroUsd: '-1' }, { actualMicroUsd: '1'.repeat(32) }, { reservedEstimatedMicroUsd: '1e9' }, { authorityId: 'other-pilot' }, { blocked: 'false' }])('rejects malformed durable accounting %j', async patch => {
    expect(await setup({ ...valid, ...patch }).read()).toMatchObject({ status: 'invalid_state', pending: null, calls: null });
  });
  it('projects only allowlisted reasons and fields', async () => {
    const view = await setup({ ...valid, quarantineReason: 'private unknown error', prompt: 'secret' }).read();
    expect(view.reason).toBe('other'); expect(JSON.stringify(view)).not.toMatch(/private|secret|prompt/);
    expect(isSurplusPilotStatus({ ...view, accountId: 'leak' })).toBe(false);
    expect(isSurplusPilotStatus({ ...view, canDispatch: true })).toBe(false);
    expect(isSurplusPilotStatus({ ...view, reason: 'raw-error' })).toBe(false);
    expect(isSurplusPilotStatus({ ...view, status: 'unknown' })).toBe(false);
  });
});
