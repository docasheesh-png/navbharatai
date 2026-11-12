import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voiceFirestore } from './helpers/voiceFirestore';

vi.mock('../src/server/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('../src/server/lib/FeatureSpendStore', () => ({ featureSpendStore: { record: vi.fn() } }));
import { setServerDb } from '../src/server/lib/serverDb';
import { reserveVoice, finishVoice, reconcileVoiceHolds, voiceOperationId, VOICE_HOLD_MS, VOICE_OPERATIONS } from '../src/server/lib/voiceAiStore';
import { checkLedgerV2Chain, type LedgerV2Row } from '../src/server/lib/ledgerV2';
import { MAX_OPEN_HOLDS } from '../src/server/lib/walletDebit';
import { mergeWallets } from '../src/server/lib/accountMerge';
import { setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint';
import { featureSpendStore } from '../src/server/lib/FeatureSpendStore';
import { TOKENS_PER_RUPEE } from '../src/lib/walletPricing';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const walletPath = (uid = 'user') => `user_token_wallets/${uid}`;
const funded = (rupees = 100) => ({ userId: 'user', tokenBalance: rupees * TOKENS_PER_RUPEE, remaining_balance: rupees,
  totalTokensUsed: 0, walletLedger: [], unrelatedPreference: 'preserve' });
let db: ReturnType<typeof voiceFirestore>;
const wallet = (uid = 'user') => db.rows.get(walletPath(uid));
const operation = (id: string) => db.rows.get(`${VOICE_OPERATIONS}/${id}`);

beforeEach(() => {
  vi.stubEnv('WALLET_MERGE_RESOLVE', 'off');
  vi.stubEnv('WALLET_LEDGER_V2_DUALWRITE', 'off');
  setFreeProgramPausedHint(false);
  db = voiceFirestore();
  db.write(walletPath(), funded());
  setServerDb(db as any);
});
afterEach(async () => {
  await vi.dynamicImportSettled();
  setServerDb(null); setFreeProgramPausedHint(null); vi.unstubAllEnvs(); vi.clearAllMocks();
});

describe('voice wallet reservation transaction', () => {
  it('writes one durable operation, mirrored debit and rate slot atomically without text or audio', async () => {
    const hold = await reserveVoice('user', 'request', 1.23, NOW);
    expect(wallet()).toMatchObject({ tokenBalance: 9877, remaining_balance: 98.77, unrelatedPreference: 'preserve' });
    expect(wallet().walletLedger[0]).toMatchObject({ feature: 'voice-generation', amountCoinsOrTokens: -123 });
    expect(operation(hold.id)).toEqual({ ...hold, state: 'pending', createdAt: NOW });
    expect(Object.keys(operation(hold.id)).sort()).toEqual(['createdAt', 'expiresAt', 'feeInr', 'id', 'ownerId', 'reservedInr', 'rollupRef', 'state', 'uid']);
    expect(db.rows.get('voice_ai_control/minute')).toEqual({ bucket: Math.floor(NOW / 60_000), count: 1 });
    expect(hold.expiresAt).toBe(NOW + VOICE_HOLD_MS);
    expect(db.commits).toBe(1);
  });

  it('preserves legitimate divergence between the two wallet views', async () => {
    db.write(walletPath(), { ...funded(), remaining_balance: 130 });
    await reserveVoice('user', 'request', 3, NOW);
    expect(wallet()).toMatchObject({ tokenBalance: 9700, remaining_balance: 127 });
  });

  it('applies one debit across simultaneous duplicate requests and transaction retries', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserveVoice('user', 'duplicate', 2, NOW)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'duplicate', status: 409 });
    expect(wallet()).toMatchObject({ tokenBalance: 9800, remaining_balance: 98 });
    expect(db.attempts).toBeGreaterThan(8);
    expect(db.rows.get('voice_ai_control/minute').count).toBe(1);
  });

  it('cannot overspend when distinct operations race for the last affordable balance', async () => {
    db.write(walletPath(), funded(1));
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => reserveVoice('user', `r${i}`, 0.6, NOW)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected') expect(result.reason.code).toBe('insufficient');
    expect(wallet()).toMatchObject({ tokenBalance: 40, remaining_balance: 0.4 });
  });

  it.each([undefined, funded(0), funded(0.99)])('rejects missing or insufficient wallets without partial state: %j', async value => {
    if (value) db.write(walletPath(), value); else db.rows.delete(walletPath());
    const before = [...db.rows.entries()];
    await expect(reserveVoice('user', 'request', 1, NOW)).rejects.toMatchObject({ code: 'insufficient', status: 402 });
    expect([...db.rows.entries()]).toEqual(before);
  });

  it('permits an exact affordable debit and never creates overdraft', async () => {
    db.write(walletPath(), funded(1));
    await reserveVoice('user', 'request', 1, NOW);
    expect(wallet()).toMatchObject({ tokenBalance: 0, remaining_balance: 0 });
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid internal fee %s without a partial write', async fee => {
    await expect(reserveVoice('user', 'request', fee, NOW)).rejects.toBeInstanceOf(Error);
    expect(wallet()).toEqual(funded());
    expect(db.commits).toBe(0);
  });

  it('a failed commit cannot leave a charged wallet, operation or rate slot', async () => {
    db.failNextCommit();
    await expect(reserveVoice('user', 'request', 1, NOW)).rejects.toThrow('synthetic commit failure');
    expect([...db.rows.keys()]).toEqual([walletPath()]);
    expect(wallet()).toEqual(funded());
  });

  it.each([50, -1, NaN, '1', 1.5])('fails closed for exhausted or corrupt global minute count %s', async count => {
    db.write('voice_ai_control/minute', { bucket: Math.floor(NOW / 60_000), count });
    await expect(reserveVoice('user', 'request', 1, NOW)).rejects.toMatchObject({ code: 'busy', status: 429 });
    expect(wallet()).toEqual(funded());
  });

  it('racing last rate slots admit one, and a new minute resets the count', async () => {
    db.write('voice_ai_control/minute', { bucket: Math.floor(NOW / 60_000), count: 49 });
    const outcomes = await Promise.allSettled(['a', 'b'].map(id => reserveVoice('user', id, 1, NOW)));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(db.rows.get('voice_ai_control/minute').count).toBe(50);
    await reserveVoice('user', 'next-minute', 1, NOW + 60_000);
    expect(db.rows.get('voice_ai_control/minute').count).toBe(1);
  });

  it('refuses a full hold bucket without evicting refundable holds or consuming the new minute slot', async () => {
    const holds = [];
    for (let i = 0; i < MAX_OPEN_HOLDS; i++) holds.push(await reserveVoice('user', `held-${i}`, 0.1, NOW));
    const before = structuredClone([...db.rows]);
    await expect(reserveVoice('user', 'overflow', 0.1, NOW + 60_000)).rejects.toMatchObject({ code: 'busy', status: 429 });
    expect([...db.rows]).toEqual(before);
    expect(wallet().walletLedger[0].openHolds).toHaveLength(MAX_OPEN_HOLDS);
    expect(wallet().walletLedger[0].openHolds[0].id).toBe(holds[0].id);
    await finishVoice(holds[0], false, NOW + 60_001);
    await reserveVoice('user', 'slot-reopened', 0.1, NOW + 60_002);
    expect(wallet().walletLedger[0].openHolds).toHaveLength(MAX_OPEN_HOLDS);
    expect(db.rows.get('voice_ai_control/minute').count).toBe(1);
  });

  it('gift-only and protected admin-build balances cannot pay for voice while gifts are paused', async () => {
    setFreeProgramPausedHint(true);
    db.write(walletPath(), { ...funded(), giftTokensRemaining: 10_000, adminBuildTokensRemaining: 5_000 });
    const before = structuredClone(wallet());
    await expect(reserveVoice('user', 'gift-only', 1, NOW)).rejects.toMatchObject({ code: 'insufficient' });
    expect(wallet()).toEqual(before);
    expect(db.commits).toBe(0);
  });

  it('paid money remains usable while gifts are paused, and refund preserves gift provenance', async () => {
    setFreeProgramPausedHint(true);
    db.write(walletPath(), { ...funded(), giftTokensRemaining: 9000, adminBuildTokensRemaining: 5000 });
    const hold = await reserveVoice('user', 'paid', 1, NOW);
    expect(wallet()).toMatchObject({ tokenBalance: 9900, giftTokensRemaining: 9000, adminBuildTokensRemaining: 5000 });
    await finishVoice(hold, false, NOW + 1);
    expect(wallet()).toMatchObject({ tokenBalance: 10_000, remaining_balance: 100, giftTokensRemaining: 9000, adminBuildTokensRemaining: 5000 });
  });

  it('scopes request identity by authenticated uid with unambiguous separators', () => {
    expect(voiceOperationId('a', 'b:c')).not.toBe(voiceOperationId('a:b', 'c'));
    expect(voiceOperationId('a', 'id')).not.toBe(voiceOperationId('b', 'id'));
    expect(voiceOperationId('a', 'id')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('charges and refunds only the canonical wallet after an account merge', async () => {
    vi.stubEnv('WALLET_MERGE_RESOLVE', 'on');
    db.write(walletPath('alias'), { ...funded(0), mergedInto: 'user' });
    const aliasBefore = structuredClone(wallet('alias'));
    const hold = await reserveVoice('alias', 'request', 2, NOW);
    expect(hold).toMatchObject({ uid: 'alias', ownerId: 'user' });
    expect(wallet().remaining_balance).toBe(98);
    await finishVoice(hold, false, NOW + 1);
    expect(wallet().remaining_balance).toBe(100);
    expect(wallet('alias')).toEqual(aliasBefore);
  });

  it('never borrows another account balance while canonical resolution is disabled', async () => {
    db.write(walletPath('alias'), { ...funded(0), mergedInto: 'user' });
    // A retired wallet is not merely empty: the store must refuse using it at all.
    await expect(reserveVoice('alias', 'request', 1, NOW)).rejects.toMatchObject({ code: 'storage' });
    expect(wallet()).toEqual(funded());
  });

  it('a merge between canonical lookup and reservation cannot charge the retired wallet', async () => {
    vi.stubEnv('WALLET_MERGE_RESOLVE', 'on');
    const run = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async callback => {
      db.write(walletPath(), { ...funded(0), mergedInto: 'new-owner' });
      db.write(walletPath('new-owner'), { ...funded(), userId: 'new-owner' });
      return run(callback);
    });
    await expect(reserveVoice('user', 'merge-race', 1, NOW)).rejects.toMatchObject({ code: 'storage' });
    expect(wallet().remaining_balance).toBe(0);
    expect(wallet('new-owner').remaining_balance).toBe(100);
    expect(db.rows.has('voice_ai_control/minute')).toBe(false);
    expect([...db.rows.keys()].some(path => path.startsWith(`${VOICE_OPERATIONS}/`))).toBe(false);
  });
});

describe.each([{ tracked: false, rupees: 20 }, { tracked: true, rupees: 25 }])('ordinary gift-only Voice funding ($rupees INR, tracked: $tracked)', ({ tracked, rupees }) => {
  const tokens = rupees * TOKENS_PER_RUPEE;
  const fee = 0.00236;
  beforeEach(() => {
    setFreeProgramPausedHint(false);
    db.write(walletPath(), { ...funded(rupees), giftTokensRemaining: tokens, totalMoneySpent: 0,
      ...(tracked ? { adminBuildTokensRemaining: 0 } : {}) });
  });

  it('admits ordinary gifts while LIVE, reserves whole tokens and settles the exact fractional fee', async () => {
    const hold = await reserveVoice('user', 'gift-tiny', fee, NOW);
    expect(hold.reservedInr).toBe(0.01);
    expect(wallet()).toMatchObject({ tokenBalance: tokens - 1, giftTokensRemaining: tokens - 1 });
    expect(wallet().walletLedger[0].openHolds[0]).toMatchObject({ id: hold.id, owed: 1, gift: 1, adminBuild: 0 });
    expect(await finishVoice(hold, true, NOW + 1)).toBe(true);
    expect(wallet()).toMatchObject({ tokenBalance: tokens, remaining_balance: rupees, giftTokensRemaining: tokens,
      totalMoneySpent: 0, tokenCarry: 0.236 });
    if (tracked) expect(wallet()).toMatchObject({ ordinaryGiftTokenCarry: 0.236, cashRequiredTokenCarry: 0, adminEligibleTokenCarry: 0, adminBuildTokensRemaining: 0 });
    expect(operation(hold.id).state).toBe('completed');
    const settled = structuredClone([...db.rows]);
    expect(await finishVoice(hold, true, NOW + 2)).toBe(false);
    expect(await finishVoice(hold, false, NOW + 2)).toBe(false);
    await expect(reserveVoice('user', 'gift-tiny', fee, NOW + 2)).rejects.toMatchObject({ code: 'duplicate' });
    expect([...db.rows]).toEqual(settled);
  });

  it('five concurrent exact settlements consume one gift token, preserve the remainder and never create paid funds', async () => {
    const holds = await Promise.all(Array.from({ length: 5 }, (_, i) => reserveVoice('user', `gift-${i}`, fee, NOW)));
    await Promise.all(holds.map(hold => finishVoice(hold, true, NOW + 1)));
    expect(wallet()).toMatchObject({ tokenBalance: tokens - 1, remaining_balance: rupees - 0.01,
      giftTokensRemaining: tokens - 1, totalTokensUsed: 1, tokenCarry: 0.18 });
    expect((tokens - wallet().tokenBalance + wallet().tokenCarry) / TOKENS_PER_RUPEE).toBeCloseTo(fee * 5, 10);
    if (tracked) expect(wallet()).toMatchObject({ ordinaryGiftTokenCarry: 0.18, cashRequiredTokenCarry: 0, adminBuildTokensRemaining: 0 });
  });

  it.each([false, true])('refunds a %s expired/failed request with its original gift provenance', async expired => {
    const hold = await reserveVoice('user', 'gift-refund', 0.12, NOW);
    expect(wallet().giftTokensRemaining).toBe(tokens - 12);
    expect(await finishVoice(hold, expired, expired ? hold.expiresAt : NOW + 1)).toBe(false);
    expect(wallet()).toMatchObject({ tokenBalance: tokens, remaining_balance: rupees,
      giftTokensRemaining: tokens, totalTokensUsed: 0, tokenCarry: 0 });
    if (tracked) expect(wallet().adminBuildTokensRemaining).toBe(0);
    expect(operation(hold.id).state).toBe('refunded');
    const refunded = structuredClone([...db.rows]);
    await finishVoice(hold, false, NOW + 2);
    await expect(reserveVoice('user', 'gift-refund', 0.12, NOW + 3)).rejects.toMatchObject({ code: 'duplicate' });
    expect([...db.rows]).toEqual(refunded);
  });

  it('concurrent delivery/refund and a later pause preserve gift provenance and existing carry', async () => {
    const tiny = await reserveVoice('user', 'gift-carry', fee, NOW);
    const delivered = await reserveVoice('user', 'gift-success', 0.12, NOW);
    const failed = await reserveVoice('user', 'gift-failure', 0.13, NOW);
    await Promise.all([finishVoice(tiny, true, NOW + 1), finishVoice(delivered, true, NOW + 1), finishVoice(failed, false, NOW + 1)]);
    expect(wallet()).toMatchObject({ tokenBalance: tokens - 12, remaining_balance: rupees - 0.12,
      giftTokensRemaining: tokens - 12, tokenCarry: 0.236 });
    const pending = await reserveVoice('user', 'pause-refund', 0.01, NOW + 2);
    setFreeProgramPausedHint(true);
    await finishVoice(pending, false, NOW + 3);
    expect(wallet()).toMatchObject({ tokenBalance: tokens - 12, giftTokensRemaining: tokens - 12, tokenCarry: 0.236 });
    if (tracked) expect(wallet()).toMatchObject({ ordinaryGiftTokenCarry: 0.236, cashRequiredTokenCarry: 0, adminBuildTokensRemaining: 0 });
    const before = structuredClone([...db.rows]);
    await expect(reserveVoice('user', 'paused-gift', fee, NOW + 4)).rejects.toMatchObject({ code: 'insufficient' });
    expect([...db.rows]).toEqual(before);
  });

  it('PAUSED gift-only admission consumes no operation, wallet funds or rate slot', async () => {
    setFreeProgramPausedHint(true);
    const before = structuredClone([...db.rows]);
    await expect(reserveVoice('user', 'paused', 0.1, NOW)).rejects.toMatchObject({ code: 'insufficient', status: 402 });
    expect([...db.rows]).toEqual(before);
  });
});

describe('Voice never spends protected build-only credits', () => {
  it.each([false, true])('rejects admin-only funds with paused=%s without any partial write', async paused => {
    setFreeProgramPausedHint(paused);
    const tokens = 25 * TOKENS_PER_RUPEE;
    db.write(walletPath(), { ...funded(25), giftTokensRemaining: tokens, adminBuildTokensRemaining: tokens });
    const before = structuredClone([...db.rows]);
    await expect(reserveVoice('user', 'admin-only', 0.01, NOW)).rejects.toMatchObject({ code: 'insufficient' });
    expect([...db.rows]).toEqual(before);
  });

  it('spends only the ordinary part of a mixed gifted wallet and keeps the admin balance protected', async () => {
    db.write(walletPath(), { ...funded(25), giftTokensRemaining: 25 * TOKENS_PER_RUPEE, adminBuildTokensRemaining: 24 * TOKENS_PER_RUPEE });
    const before = structuredClone([...db.rows]);
    await expect(reserveVoice('user', 'too-much', 1.01, NOW)).rejects.toMatchObject({ code: 'insufficient' });
    expect([...db.rows]).toEqual(before);
    const hold = await reserveVoice('user', 'ordinary-only', 1, NOW);
    await finishVoice(hold, true, NOW + 1);
    expect(wallet()).toMatchObject({ tokenBalance: 24 * TOKENS_PER_RUPEE, remaining_balance: 24,
      giftTokensRemaining: 24 * TOKENS_PER_RUPEE, adminBuildTokensRemaining: 24 * TOKENS_PER_RUPEE });
    await expect(reserveVoice('user', 'admin-remains', 0.01, NOW + 2)).rejects.toMatchObject({ code: 'insufficient' });
  });

  it('a never-paid legacy wallet with no gift field is still ordinary gift, not purchased cash', async () => {
    db.write(walletPath(), { ...funded(20), totalMoneySpent: 0 });
    const hold = await reserveVoice('user', 'legacy-inferred', 0.12, NOW);
    expect(wallet().giftTokensRemaining).toBe(20 * TOKENS_PER_RUPEE - 12);
    await finishVoice(hold, false, NOW + 1);
    expect(wallet().giftTokensRemaining).toBe(20 * TOKENS_PER_RUPEE);
    setFreeProgramPausedHint(true);
    await expect(reserveVoice('user', 'inferred-paused', 0.01, NOW + 2)).rejects.toMatchObject({ code: 'insufficient' });
  });
});

describe('voice settlement and crash recovery', () => {
  it('settles once, removes the hold, and keeps the exact original charge', async () => {
    const hold = await reserveVoice('user', 'request', 1, NOW);
    expect(await finishVoice(hold, true, NOW + 1)).toBe(true);
    expect(operation(hold.id)).toMatchObject({ state: 'completed', expiresAt: null, finishedAt: NOW + 1 });
    expect(wallet()).toMatchObject({ tokenBalance: 9900, remaining_balance: 99 });
    expect(wallet().walletLedger.flatMap((row: any) => row.openHolds ?? [])).toEqual([]);
    expect(await finishVoice(hold, true, NOW + 2)).toBe(false);
    expect(await finishVoice(hold, false, NOW + 2)).toBe(false);
    await expect(reserveVoice('user', 'request', 1, NOW + 60_000)).rejects.toMatchObject({ code: 'duplicate' });
  });

  it.each(['source', 'destination'])('a legacy wallet with a live voice hold cannot be merged as %s', async side => {
    const hold = await reserveVoice('user', 'merge-pending', 1, NOW);
    const reserved = wallet();
    expect(reserved.adminBuildTokensRemaining).toBeUndefined();
    const args = side === 'source' ? [funded(), reserved] : [reserved, funded()];
    expect(() => mergeWallets(args[0], args[1], new Date(NOW).toISOString())).toThrow(/pending wallet reservations/);
    await finishVoice(hold, false, NOW + 1);
    expect(() => mergeWallets(wallet(), funded(), new Date(NOW + 1).toISOString())).not.toThrow();
  });

  it('concurrent failure refunds restore both balance views only once', async () => {
    const hold = await reserveVoice('user', 'request', 1.23, NOW);
    await Promise.all(Array.from({ length: 8 }, () => finishVoice(hold, false, NOW + 1)));
    expect(wallet()).toMatchObject({ tokenBalance: 10_000, remaining_balance: 100 });
    expect(operation(hold.id).state).toBe('refunded');
    expect(await finishVoice(hold, true, NOW + 2)).toBe(false);
    await expect(reserveVoice('user', 'request', 1.23, NOW + 2)).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('racing settlement and refund have exactly one terminal outcome', async () => {
    const hold = await reserveVoice('user', 'request', 3, NOW);
    await Promise.all([finishVoice(hold, true, NOW + 1), finishVoice(hold, false, NOW + 1)]);
    const state = operation(hold.id).state;
    expect(['completed', 'refunded']).toContain(state);
    expect(wallet().remaining_balance).toBe(state === 'completed' ? 97 : 100);
    expect(wallet().walletLedger.flatMap((row: any) => row.openHolds ?? [])).toEqual([]);
  });

  it.each(['uid', 'ownerId', 'feeInr', 'reservedInr', 'rollupRef', 'expiresAt'] as const)('rejects a forged %s without touching either wallet', async field => {
    const hold = await reserveVoice('user', 'request', 1, NOW);
    db.write(walletPath('other'), funded(200));
    const before = structuredClone([...db.rows]);
    const forged = { ...hold, [field]: typeof hold[field] === 'number' ? Number(hold[field]) + 1 : 'other' };
    await expect(finishVoice(forged, false, NOW + 1)).rejects.toMatchObject({ code: 'storage' });
    expect([...db.rows]).toEqual(before);
  });

  it('refuses missing wallets, leaving the operation recoverable rather than marking a fake refund', async () => {
    const hold = await reserveVoice('user', 'request', 1, NOW);
    db.rows.delete(walletPath());
    await expect(finishVoice(hold, false, NOW + 1)).rejects.toMatchObject({ code: 'storage' });
    expect(operation(hold.id).state).toBe('pending');
  });

  it('database unavailability fails closed, and the background recovery is a no-op', async () => {
    const hold = await reserveVoice('user', 'request', 1, NOW);
    setServerDb(null);
    await expect(reserveVoice('user', 'another', 1, NOW)).rejects.toMatchObject({ code: 'storage' });
    await expect(finishVoice(hold, false, NOW)).rejects.toMatchObject({ code: 'storage' });
    expect(await reconcileVoiceHolds(NOW)).toBe(0);
  });

  it('an expired success is refunded at the exact boundary, never billed', async () => {
    const hold = await reserveVoice('user', 'request', 1, NOW);
    expect(await finishVoice(hold, true, hold.expiresAt)).toBe(false);
    expect(wallet().remaining_balance).toBe(100);
    expect(operation(hold.id).state).toBe('refunded');
  });

  it('recovers expired holds without touching live holds or generating inference', async () => {
    const expired = await reserveVoice('user', 'expired', 1, NOW);
    const live = await reserveVoice('user', 'live', 2, NOW + 1000);
    expect(await reconcileVoiceHolds(expired.expiresAt)).toBe(1);
    expect(wallet().remaining_balance).toBe(98);
    expect(operation(expired.id).state).toBe('refunded');
    expect(operation(live.id).state).toBe('pending');
    expect(await reconcileVoiceHolds(expired.expiresAt)).toBe(0);
  });

  it('bounds each recovery pass and can finish the remaining expired page', async () => {
    for (let i = 0; i < 22; i++) await reserveVoice('user', `request-${i}`, 0.1, NOW);
    expect(await reconcileVoiceHolds(NOW + VOICE_HOLD_MS)).toBe(20);
    expect(await reconcileVoiceHolds(NOW + VOICE_HOLD_MS)).toBe(2);
    expect(wallet()).toMatchObject({ tokenBalance: 10_000, remaining_balance: 100 });
  });

  it('never uses malformed operation records as refund instructions', async () => {
    db.write(`${VOICE_OPERATIONS}/forged`, { id: 'wrong-id', uid: 'user', ownerId: 'user', feeInr: 100,
      rollupRef: 'fake', state: 'pending', expiresAt: NOW - 1 });
    expect(await reconcileVoiceHolds(NOW)).toBe(0);
    expect(wallet()).toEqual(funded());
  });

  it('one unrecoverable expired hold does not block another wallet refund in the same pass', async () => {
    const broken = await reserveVoice('user', 'broken', 1, NOW);
    db.write(walletPath('healthy'), { ...funded(5), userId: 'healthy' });
    const healthy = await reserveVoice('healthy', 'recoverable', 2, NOW);
    db.rows.delete(walletPath());
    expect(await reconcileVoiceHolds(NOW + VOICE_HOLD_MS)).toBe(1);
    expect(operation(broken.id).state).toBe('pending');
    expect(operation(healthy.id).state).toBe('refunded');
    expect(wallet('healthy').remaining_balance).toBe(5);
  });

  it('a full page of malformed records cannot permanently starve valid expired refunds behind it', async () => {
    for (let i = 0; i < 20; i++) {
      db.write(`${VOICE_OPERATIONS}/poison-${i}`, { id: 'wrong-id', uid: 'user', ownerId: 'user', feeInr: 1,
        rollupRef: 'fake', state: 'pending', expiresAt: NOW - 1 });
    }
    const valid = await reserveVoice('user', 'valid-after-poison', 1, NOW);
    expect(await reconcileVoiceHolds(NOW + VOICE_HOLD_MS)).toBe(0);
    expect(operation(valid.id).state).toBe('pending');
    expect(await reconcileVoiceHolds(NOW + VOICE_HOLD_MS)).toBe(1);
    expect(operation(valid.id).state).toBe('refunded');
    expect(wallet().remaining_balance).toBe(100);
  });

  it('keeps a complete immutable ledger chain for debit and refund when dual-write is enabled', async () => {
    vi.stubEnv('WALLET_LEDGER_V2_DUALWRITE', 'on');
    const hold = await reserveVoice('user', 'request', 1, NOW);
    await finishVoice(hold, false, NOW + 1);
    const ledger = [...db.rows.entries()].filter(([path]) => path.startsWith('wallet_ledger/')).map(([, row]) => row as LedgerV2Row);
    expect(ledger).toHaveLength(2);
    expect(ledger.map(row => row.deltaTokens)).toEqual([-100, 100]);
    expect(checkLedgerV2Chain(ledger, wallet().tokenBalance)).toEqual({ ok: true, problems: [] });
  });
});

describe.each([false, true])('exact sub-paise billing (source-tracked wallet: %s)', tracked => {
  const fee = 0.00236;
  beforeEach(() => {
    setFreeProgramPausedHint(true);
    db.write(walletPath(), { ...funded(1), giftTokensRemaining: 0,
      ...(tracked ? { adminBuildTokensRemaining: 0 } : {}) });
  });

  it('reserves a refundable whole token but settles only the exact tiny fee into carry', async () => {
    const hold = await reserveVoice('user', 'tiny', fee, NOW);
    expect(hold).toMatchObject({ feeInr: fee, reservedInr: 0.01 });
    expect(operation(hold.id)).toMatchObject({ feeInr: fee, reservedInr: 0.01, state: 'pending' });
    expect(wallet()).toMatchObject({ tokenBalance: 99, remaining_balance: 0.99 });
    expect(await finishVoice(hold, true, NOW + 1)).toBe(true);
    expect(wallet()).toMatchObject({ tokenBalance: 100, remaining_balance: 1, totalTokensUsed: 0, tokenCarry: 0.236, giftTokensRemaining: 0 });
    if (tracked) expect(wallet()).toMatchObject({ cashRequiredTokenCarry: 0.236, ordinaryGiftTokenCarry: 0, adminEligibleTokenCarry: 0 });
    expect(wallet().walletLedger.flatMap((row: any) => row.openHolds ?? [])).toEqual([]);
    expect(operation(hold.id)).toMatchObject({ feeInr: fee, reservedInr: 0.01, state: 'completed' });
    expect((100 - wallet().tokenBalance + wallet().tokenCarry) / 100).toBeCloseTo(fee, 10);
  });

  it('five simultaneous settlements materialize one token, retain the exact remainder and never round each fee up', async () => {
    const holds = await Promise.all(Array.from({ length: 5 }, (_, index) => reserveVoice('user', `tiny-${index}`, fee, NOW)));
    expect(wallet().tokenBalance).toBe(95);
    expect(await Promise.all(holds.map(hold => finishVoice(hold, true, NOW + 1)))).toEqual([true, true, true, true, true]);
    expect(wallet()).toMatchObject({ tokenBalance: 99, remaining_balance: 0.99, totalTokensUsed: 1, tokenCarry: 0.18 });
    const settled = structuredClone(wallet());
    await Promise.all(holds.map(hold => finishVoice(hold, true, NOW + 2)));
    expect(wallet()).toEqual(settled);
    expect((100 - wallet().tokenBalance + wallet().tokenCarry) / 100).toBeCloseTo(fee * 5, 10);
    if (tracked) expect(wallet()).toMatchObject({ cashRequiredTokenCarry: 0.18, ordinaryGiftTokenCarry: 0, adminEligibleTokenCarry: 0 });
    await vi.dynamicImportSettled();
    expect(featureSpendStore.record).toHaveBeenCalledExactlyOnceWith('voice-generation', 0.01, 'user');
  });

  it('a failed tiny operation refunds the full temporary hold without changing previously accrued carry', async () => {
    const first = await reserveVoice('user', 'delivered', fee, NOW);
    await finishVoice(first, true, NOW + 1);
    const pending = await reserveVoice('user', 'failed', fee, NOW + 2);
    expect(wallet()).toMatchObject({ tokenBalance: 99, tokenCarry: 0.236 });
    await finishVoice(pending, false, NOW + 3);
    expect(wallet()).toMatchObject({ tokenBalance: 100, remaining_balance: 1, tokenCarry: 0.236, giftTokensRemaining: 0 });
    if (tracked) expect(wallet().cashRequiredTokenCarry).toBe(0.236);
    expect(operation(pending.id).state).toBe('refunded');
  });

  it('a failed exact-settlement commit cannot partially release or charge, and a retry settles once', async () => {
    const hold = await reserveVoice('user', 'atomic-tiny', fee, NOW);
    const reserved = structuredClone([...db.rows]);
    db.failNextCommit();
    await expect(finishVoice(hold, true, NOW + 1)).rejects.toThrow('synthetic commit failure');
    expect([...db.rows]).toEqual(reserved);
    expect(operation(hold.id).state).toBe('pending');
    expect(await finishVoice(hold, true, NOW + 2)).toBe(true);
    expect(await finishVoice(hold, true, NOW + 3)).toBe(false);
    expect(wallet()).toMatchObject({ tokenBalance: 100, remaining_balance: 1, tokenCarry: 0.236 });
  });

  it('concurrent delivered and failed operations retain exact charges and preserve gift/admin provenance', async () => {
    db.write(walletPath(), { ...funded(1), giftTokensRemaining: 60,
      ...(tracked ? { adminBuildTokensRemaining: 30 } : {}) });
    const tiny = await reserveVoice('user', 'tiny', fee, NOW);
    const delivered = await reserveVoice('user', 'delivered', 0.12, NOW);
    const failed = await reserveVoice('user', 'failed', 0.13, NOW);
    await Promise.all([finishVoice(tiny, true, NOW + 1), finishVoice(delivered, true, NOW + 1), finishVoice(failed, false, NOW + 1)]);
    expect(wallet()).toMatchObject({ tokenBalance: 88, remaining_balance: 0.88, tokenCarry: 0.236, giftTokensRemaining: 60 });
    if (tracked) expect(wallet()).toMatchObject({ adminBuildTokensRemaining: 30, cashRequiredTokenCarry: 0.236, ordinaryGiftTokenCarry: 0, adminEligibleTokenCarry: 0 });
    expect((100 - wallet().tokenBalance + wallet().tokenCarry) / 100).toBeCloseTo(0.12 + fee, 10);
    expect(wallet().walletLedger.flatMap((row: any) => row.openHolds ?? [])).toEqual([]);
  });

  it('keeps the immutable ledger reconciled while changing a rounded reservation into an exact fractional charge', async () => {
    vi.stubEnv('WALLET_LEDGER_V2_DUALWRITE', 'on');
    const hold = await reserveVoice('user', 'tiny-ledger', fee, NOW);
    await finishVoice(hold, true, NOW + 1);
    const ledger = [...db.rows.entries()].filter(([path]) => path.startsWith('wallet_ledger/')).map(([, row]) => row as LedgerV2Row);
    expect(ledger).toHaveLength(2);
    expect(ledger.map(row => row.deltaTokens)).toEqual([-1, 1]);
    expect(checkLedgerV2Chain(ledger, wallet().tokenBalance)).toEqual({ ok: true, problems: [] });
    expect(wallet().tokenCarry).toBe(0.236);
  });
});
