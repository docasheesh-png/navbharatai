import { EventEmitter } from 'node:events';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  account: vi.fn(), reserve: vi.fn(), finish: vi.fn(), synthesize: vi.fn(), triage: vi.fn(),
  maintenance: vi.fn(), inference: vi.fn(), scope: vi.fn(), rateLimiter: vi.fn(), audit: vi.fn(), featureSpend: vi.fn(),
  freeProgram: vi.fn(),
}));
vi.mock('../src/server/lib/authMiddleware', () => ({ rateLimiter: mocks.rateLimiter }));
vi.mock('../src/server/lib/costlyAiAccess', () => ({ requireAccountForCostlyAi: mocks.account }));
vi.mock('../src/server/lib/voiceAiStore', () => ({ reserveVoice: mocks.reserve, finishVoice: mocks.finish }));
vi.mock('../src/server/lib/voiceAi', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/lib/voiceAi')>(), synthesizeVoice: mocks.synthesize,
}));
vi.mock('../src/server/lib/promptSafety', () => ({ triagePrompt: mocks.triage, blockMessage: () => 'This text cannot be generated.' }));
vi.mock('../src/server/lib/providerSwitches', () => ({ isProviderSwitchedOff: () => false }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: mocks.maintenance }));
vi.mock('../src/server/lib/freeProgram', () => ({ freeProgramPaused: mocks.freeProgram }));
vi.mock('../src/server/AI/inferencePolicy', () => ({
  freeModuleInferenceScope: (_req: unknown, _res: unknown, next: () => void) => next(), assertLegacyInferenceAllowed: mocks.inference,
  runWithInferenceScope: mocks.scope,
}));
vi.mock('../src/server/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('../src/server/lib/FeatureSpendStore', () => ({ featureSpendStore: { record: mocks.featureSpend } }));

import { registerVoiceAiRoutes } from '../src/server/routes/voiceAi';
import { VoiceAiError } from '../src/server/lib/voiceAi';
import { freeModuleInferenceScope } from '../src/server/AI/inferencePolicy';
import { freeProgramPausedHint, setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint';
import { setServerDb } from '../src/server/lib/serverDb';
import { voiceFirestore } from './helpers/voiceFirestore';
import { TOKENS_PER_RUPEE } from '../src/lib/walletPricing';

const INPUT = { text: 'Hello', language: 'en-IN', voice: 'simran_en_customer', requestId: '11111111-1111-4111-8111-111111111111', acceptedPriceInr: 0.1 };
const HOLD = { id: 'operation', uid: 'verified-user', ownerId: 'canonical', rollupRef: 'voice-rollup', feeInr: 0.1, reservedInr: 0.1, expiresAt: 2000000000000 };
type Handler = (req: any, res: any, next?: () => void) => any;
let routes: Map<string, Handler[]>;
let limiter: ReturnType<typeof vi.fn>;

function response(autoFinish = true) {
  return Object.assign(new EventEmitter(), {
    code: 200, headers: {} as Record<string, string>, payload: undefined as any,
    headersSent: false, destroyed: false, writableEnded: false, writableFinished: false,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.code = code; return this; },
    json(payload: unknown) {
      this.payload = payload; this.headersSent = true; this.writableEnded = true;
      if (autoFinish) { this.writableFinished = true; this.emit('finish'); }
      return this;
    },
    disconnect() { this.destroyed = true; this.emit('close'); },
    destroy() { this.destroyed = true; this.emit('close'); return this; },
  });
}
function invoke(overrides: Record<string, unknown> = {}, res = response()) {
  const req = { body: { ...INPUT, ...overrides }, headers: { authorization: 'Bearer synthetic' } };
  const done = Promise.resolve(routes.get('POST /api/voice-ai/generate')!.at(-1)!(req, res));
  return { req, res, done };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VOICE_AI_ENABLED', '1'); vi.stubEnv('SARVAM_API_KEY', 'synthetic-not-a-secret');
  vi.stubEnv('SARVAM_TTS_INR_PER_1000_CHARS', '10'); vi.stubEnv('SARVAM_TTS_COST_TAX_PERCENT', '0');
  mocks.account.mockResolvedValue({ ok: true, uid: 'verified-user', email: null });
  mocks.reserve.mockResolvedValue(HOLD); mocks.finish.mockImplementation(async (_hold, sent) => sent);
  mocks.synthesize.mockResolvedValue('synthetic-audio'); mocks.triage.mockReturnValue({ verdict: 'allow' });
  mocks.scope.mockImplementation((_scope, callback) => callback());
  mocks.maintenance.mockResolvedValue(undefined); mocks.featureSpend.mockResolvedValue(undefined);
  mocks.freeProgram.mockResolvedValue(false); setFreeProgramPausedHint(null);
  limiter = vi.fn((_req, _res, next) => next()); mocks.rateLimiter.mockReturnValue(limiter);
  routes = new Map();
  registerVoiceAiRoutes({
    get: (path: string, ...handlers: Handler[]) => routes.set(`GET ${path}`, handlers),
    post: (path: string, ...handlers: Handler[]) => routes.set(`POST ${path}`, handlers),
  } as unknown as Express);
});
afterEach(async () => { await vi.dynamicImportSettled(); setServerDb(null); vi.useRealTimers(); vi.unstubAllEnvs(); setFreeProgramPausedHint(null); });

describe('voice routes admission and pricing', () => {
  it('wires inference scope and anonymous-denying limiter before the generation handler', () => {
    expect(routes.get('POST /api/voice-ai/generate')!.slice(0, 2)).toEqual([freeModuleInferenceScope, limiter]);
    expect(mocks.rateLimiter).toHaveBeenCalledWith({ name: 'voice-ai', authed: 30, anon: 0, anonGlobalPerHour: 0, noun: 'voice generations' });
  });

  it('serves public no-store pricing without credentials, inference or payment', async () => {
    const res = response();
    await routes.get('GET /api/voice-ai/config')![0]({}, res);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.payload).toMatchObject({ available: true, pricePer1000CharactersInr: 20, maxCharacters: 2500 });
    expect(JSON.stringify(res.payload)).not.toMatch(/synthetic-not-a-secret|api_key|bulbul|sarvam/i);
    expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it.each([401, 403])('returns account gate status %s before inspecting input or calling anything billable', async status => {
    mocks.account.mockResolvedValue({ ok: false, status, body: { code: 'login_required', error: 'Sign in.' } });
    const call = invoke({ text: null }); await call.done;
    expect(mocks.account).toHaveBeenCalledWith(call.req, 'voice generation');
    expect(call.res.code).toBe(status); expect(call.res.payload.code).toBe('login_required');
    expect(mocks.triage).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(call.res.listenerCount('close')).toBe(0);
  });

  it('rejects client-supplied user or wallet identifiers before any charge', async () => {
    const call = invoke({ uid: 'victim', ownerId: 'victim', userId: 'victim' }); await call.done;
    expect(call.res.code).toBe(400); expect(call.res.payload.code).toBe('invalid');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it('uses the verified account uid to reserve the wallet for valid input', async () => {
    const call = invoke(); await call.done;
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith('verified-user', INPUT.requestId, 0.1);
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, true);
  });

  it('awaits a real LIVE policy read before a cold wallet admission or paid dispatch', async () => {
    setFreeProgramPausedHint(true);
    const policy = deferred<boolean>(); mocks.freeProgram.mockReturnValue(policy.promise);
    mocks.reserve.mockImplementation(async () => { expect(freeProgramPausedHint()).toBe(false); return HOLD; });
    const call = invoke(); await vi.waitFor(() => expect(mocks.freeProgram).toHaveBeenCalledTimes(1));
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.scope).not.toHaveBeenCalled();
    policy.resolve(false); await call.done;
    expect(mocks.reserve).toHaveBeenCalledTimes(1); expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(mocks.freeProgram.mock.invocationCallOrder[0]).toBeLessThan(mocks.reserve.mock.invocationCallOrder[0]);
  });

  it('applies the returned PAUSED restriction even if an earlier hint was LIVE, without banning paid funds', async () => {
    setFreeProgramPausedHint(false); mocks.freeProgram.mockResolvedValue(true);
    mocks.reserve.mockImplementation(async () => { expect(freeProgramPausedHint()).toBe(true); return HOLD; });
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(200); expect(mocks.synthesize).toHaveBeenCalledTimes(1);
  });

  it('a policy read error dispatches nothing and does not touch the wallet', async () => {
    mocks.freeProgram.mockRejectedValue(new Error('private storage failure'));
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(503); expect(call.res.payload.code).toBe('unavailable');
    expect(call.res.payload.error).not.toContain('private');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.synthesize).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  });

  it('a disconnect while the policy read is pending cannot reserve or dispatch later', async () => {
    const policy = deferred<boolean>(); mocks.freeProgram.mockReturnValue(policy.promise);
    const call = invoke(); await vi.waitFor(() => expect(mocks.freeProgram).toHaveBeenCalledTimes(1));
    call.res.disconnect(); policy.resolve(false); await call.done;
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.synthesize).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  });

  it.each([{ text: '' }, { language: 'unsupported' }, { voice: 'cloned' }, { requestId: 'replay' }, { acceptedPriceInr: 0 }])('rejects malformed input without reserving: %j', async changes => {
    const call = invoke(changes); await call.done;
    expect(call.res.code).toBe(400); expect(call.res.payload.code).toBe('invalid');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it('safety-blocked text never consumes credits or inference', async () => {
    mocks.triage.mockReturnValue({ verdict: 'block', contentClass: 'unsafe' });
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(422); expect(call.res.payload.code).toBe('blocked');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it.each([0.09, 0.11])('requires acceptance of the exact current fee, received %s', async acceptedPriceInr => {
    const call = invoke({ acceptedPriceInr }); await call.done;
    expect(call.res.code).toBe(409); expect(call.res.payload.code).toBe('price_changed');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it('accepts and reports the exact sub-paise quote rather than the temporary rounded reservation', async () => {
    vi.stubEnv('SARVAM_TTS_INR_PER_1000_CHARS', '1'); vi.stubEnv('SARVAM_TTS_COST_TAX_PERCENT', '18');
    mocks.reserve.mockResolvedValue({ ...HOLD, feeInr: 0.00236, reservedInr: 0.01 });
    const call = invoke({ text: 'A', acceptedPriceInr: 0.00236 }); await call.done;
    expect(call.res.code).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith('verified-user', INPUT.requestId, 0.00236);
    expect(call.res.payload).toMatchObject({ chargedInr: 0.00236, characters: 1 });
  });

  it('does not treat acceptance of the rounded temporary hold as acceptance of the exact quote', async () => {
    vi.stubEnv('SARVAM_TTS_INR_PER_1000_CHARS', '1'); vi.stubEnv('SARVAM_TTS_COST_TAX_PERCENT', '18');
    const call = invoke({ text: 'A', acceptedPriceInr: 0.01 }); await call.done;
    expect(call.res.code).toBe(409); expect(call.res.payload.code).toBe('price_changed');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it('never starts payment or inference while disabled or unpriced', async () => {
    vi.stubEnv('SARVAM_TTS_COST_TAX_PERCENT', '');
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(503); expect(call.res.payload.code).toBe('unavailable');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it('honors maintenance before reserving money or entering a paid scope', async () => {
    mocks.maintenance.mockImplementation(() => { throw new Error('secret infrastructure details'); });
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(503); expect(call.res.payload.error).not.toContain('secret');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
  });

  it('enters paid-voice only after the wallet hold succeeds, with synthesis inside that scope', async () => {
    const reservation = deferred<typeof HOLD>();
    mocks.reserve.mockReturnValue(reservation.promise);
    let insidePaidScope = false;
    mocks.scope.mockImplementation((scope, callback) => {
      expect(scope).toBe('paid-voice');
      insidePaidScope = true;
      try { return callback(); } finally { insidePaidScope = false; }
    });
    mocks.synthesize.mockImplementation(async () => {
      expect(insidePaidScope).toBe(true);
      return 'synthetic-audio';
    });
    const call = invoke(); await vi.waitFor(() => expect(mocks.reserve).toHaveBeenCalledTimes(1));
    expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
    reservation.resolve(HOLD); await call.done;
    expect(mocks.scope).toHaveBeenCalledExactlyOnceWith('paid-voice', expect.any(Function));
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.scope.mock.invocationCallOrder[0]);
    expect(mocks.scope.mock.invocationCallOrder[0]).toBeLessThan(mocks.synthesize.mock.invocationCallOrder[0]);
  });

  it('a dispatch policy refusal after reservation refunds the hold without leaking its error', async () => {
    mocks.scope.mockImplementation(() => { throw new Error('secret dispatch policy details'); });
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(503); expect(call.res.payload.error).not.toContain('secret');
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.scope).toHaveBeenCalledExactlyOnceWith('paid-voice', expect.any(Function));
    expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, false);
  });

  it.each([['insufficient', 402], ['duplicate', 409], ['busy', 429], ['storage', 503]] as const)('failed admission %s dispatches no inference and no refund', async (code, status) => {
    mocks.reserve.mockRejectedValue(new VoiceAiError(code, status));
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(status); expect(call.res.payload.code).toBe(code);
    expect(mocks.synthesize).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
  });
});

describe('Voice route with real policy reads and real gift wallet accounting', () => {
  let db: ReturnType<typeof voiceFirestore>;
  let clockNow: number;
  let readPolicy: ReturnType<typeof vi.fn>;
  let policy: import('../src/server/lib/freeProgram').FreeProgramStore;
  beforeEach(async () => {
    vi.stubEnv('WALLET_MERGE_RESOLVE', 'off'); vi.stubEnv('WALLET_LEDGER_V2_DUALWRITE', 'off');
    db = voiceFirestore(); setServerDb(db as any);
    const realStore = await vi.importActual<typeof import('../src/server/lib/voiceAiStore')>('../src/server/lib/voiceAiStore');
    mocks.reserve.mockImplementation(realStore.reserveVoice); mocks.finish.mockImplementation(realStore.finishVoice);
    const { FreeProgramStore } = await vi.importActual<typeof import('../src/server/lib/freeProgram')>('../src/server/lib/freeProgram');
    clockNow = 0; readPolicy = vi.fn().mockResolvedValue({ paused: false });
    policy = new FreeProgramStore(() => ({ read: readPolicy, write: async () => {} }), () => clockNow, () => true);
    mocks.freeProgram.mockImplementation(async () => (await policy.read()).paused);
    setFreeProgramPausedHint(true);
  });
  const fundGift = (db: ReturnType<typeof voiceFirestore>, tracked = false) => db.write('user_token_wallets/verified-user', {
    userId: 'verified-user', tokenBalance: 25 * TOKENS_PER_RUPEE, remaining_balance: 25,
    giftTokensRemaining: 25 * TOKENS_PER_RUPEE, totalMoneySpent: 0, totalTokensUsed: 0, walletLedger: [],
    ...(tracked ? { adminBuildTokensRemaining: 0 } : {}),
  });

  it.each([false, true])('a cold LIVE read admits a gift-only wallet without a purchase (tracked=%s)', async tracked => {
    fundGift(db, tracked);
    expect(freeProgramPausedHint()).toBe(true);
    const call = invoke(); await call.done;
    expect(readPolicy).toHaveBeenCalledTimes(1); expect(call.res.code).toBe(200);
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(db.rows.get('user_token_wallets/verified-user')).toMatchObject({ tokenBalance: 2490, remaining_balance: 24.9,
      giftTokensRemaining: 2490, totalMoneySpent: 0 });
    expect([...db.rows].find(([path]) => path.startsWith('voice_ai_operations/'))?.[1].state).toBe('completed');
  });

  it('an actual PAUSED read rejects a gift-only wallet before paid scope/provider dispatch', async () => {
    fundGift(db, true); readPolicy.mockResolvedValue({ paused: true });
    const before = structuredClone([...db.rows]);
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(402); expect(call.res.payload.code).toBe('insufficient');
    expect([...db.rows]).toEqual(before); expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it('a failed refresh after LIVE cannot buy speech using the old live gift hint', async () => {
    fundGift(db, true); await policy.read(); expect(freeProgramPausedHint()).toBe(false);
    clockNow = 2001; readPolicy.mockRejectedValue(new Error('private storage failure'));
    const before = structuredClone([...db.rows]);
    const call = invoke(); await call.done;
    expect(readPolicy).toHaveBeenCalledTimes(2); expect(freeProgramPausedHint()).toBe(true);
    expect(call.res.code).toBe(402); expect(call.res.payload.code).toBe('insufficient');
    expect([...db.rows]).toEqual(before); expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(JSON.stringify(call.res.payload)).not.toContain('private');
  });

  it('the same failed refresh still permits purchased funds without consuming any gift', async () => {
    fundGift(db, true); await policy.read();
    db.write('user_token_wallets/verified-user', { ...db.rows.get('user_token_wallets/verified-user'), giftTokensRemaining: 24 * TOKENS_PER_RUPEE });
    clockNow = 2001; readPolicy.mockRejectedValue(new Error('unavailable'));
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(200); expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(db.rows.get('user_token_wallets/verified-user')).toMatchObject({ tokenBalance: 2490, giftTokensRemaining: 2400 });
  });
});

describe('voice delivery, failures and cancellation', () => {
  it('destroys a response stalled for 120 seconds and refunds without settling or retrying synthesis', async () => {
    vi.useFakeTimers();
    const res = response(false);
    const destroy = vi.spyOn(res, 'destroy');
    const call = invoke({}, res);
    await vi.advanceTimersByTimeAsync(0);
    expect(res.payload?.audio).toBe('synthetic-audio');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(destroy).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await call.done;
    expect(destroy).toHaveBeenCalledTimes(1); expect(res.destroyed).toBe(true);
    expect(mocks.synthesize.mock.calls[0][1].aborted).toBe(true);
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, false);
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalledWith('VOICE_AI_GENERATED', expect.anything());
    expect(vi.getTimerCount()).toBe(0);
    expect(res.listenerCount('finish')).toBe(0); expect(res.listenerCount('close')).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(destroy).toHaveBeenCalledTimes(1); expect(mocks.finish).toHaveBeenCalledTimes(1);
  });

  it.each(['finish', 'close'] as const)('cleans the flush timer after early %s and cannot fire a late refund', async event => {
    vi.useFakeTimers();
    const res = response(false);
    const destroy = vi.spyOn(res, 'destroy');
    const call = invoke({}, res);
    await vi.advanceTimersByTimeAsync(0);
    expect(res.headersSent).toBe(true); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    if (event === 'finish') { res.writableFinished = true; res.emit('finish'); }
    else res.disconnect();
    await call.done;
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, event === 'finish');
    expect(vi.getTimerCount()).toBe(0);
    expect(res.listenerCount('finish')).toBe(0); expect(res.listenerCount('close')).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(destroy).not.toHaveBeenCalled(); expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(res.destroyed).toBe(event === 'close');
  });

  it('cleans the flush timer when the response finishes synchronously', async () => {
    vi.useFakeTimers();
    const call = invoke(); await call.done;
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(call.res.destroyed).toBe(false); expect(mocks.finish).toHaveBeenCalledTimes(1);
  });

  it('sends one audio response and settles only after the HTTP finish event', async () => {
    const res = response(false); const call = invoke({}, res);
    await vi.waitFor(() => expect(res.payload?.audio).toBe('synthetic-audio'));
    expect(mocks.finish).not.toHaveBeenCalled();
    res.writableFinished = true; res.emit('finish'); await call.done;
    expect(res.payload).toEqual({ audio: 'synthetic-audio', mimeType: 'audio/wav', chargedInr: 0.1, characters: 5 });
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(mocks.synthesize.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, true);
    expect(res.listenerCount('finish')).toBe(0); expect(res.listenerCount('close')).toBe(0);
  });

  it('close before HTTP finish refunds even after json() has been called', async () => {
    const res = response(false); const call = invoke({}, res);
    await vi.waitFor(() => expect(res.headersSent).toBe(true));
    expect(res.writableEnded).toBe(true); expect(res.writableFinished).toBe(false);
    res.disconnect(); await call.done;
    expect(mocks.synthesize.mock.calls[0][1].aborted).toBe(true);
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, false);
    expect(mocks.audit).not.toHaveBeenCalledWith('VOICE_AI_GENERATED', expect.anything());
    expect(res.listenerCount('finish')).toBe(0); expect(res.listenerCount('close')).toBe(0);
  });

  it('normal close after HTTP finish is not a failed delivery or second charge', async () => {
    const res = response(false); const call = invoke({}, res);
    await vi.waitFor(() => expect(res.headersSent).toBe(true));
    res.writableFinished = true; res.emit('finish'); res.emit('close'); await call.done;
    expect(mocks.synthesize.mock.calls[0][1].aborted).toBe(false);
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, true);
  });

  it('provider failure refunds once, reports failure, and never retries or falls back', async () => {
    mocks.synthesize.mockRejectedValue(new VoiceAiError('provider_failed', 502));
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(502); expect(call.res.payload.error).toContain('No automatic retry');
    expect(mocks.reserve).toHaveBeenCalledTimes(1); expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, false);
  });

  it('refund write failure is disclosed without leaking provider errors or retrying inference', async () => {
    mocks.synthesize.mockRejectedValue(new Error('private prompt and credential'));
    mocks.finish.mockRejectedValue(new Error('database unavailable'));
    const call = invoke(); await call.done;
    expect(call.res.payload.error).toContain('refund is pending recovery');
    expect(JSON.stringify(call.res.payload)).not.toMatch(/private prompt|credential|database unavailable/);
    expect(mocks.audit).toHaveBeenCalledWith('VOICE_AI_REFUND_PENDING', { uid: HOLD.uid, operationId: HOLD.id }, 'error');
    expect(mocks.synthesize).toHaveBeenCalledTimes(1); expect(mocks.finish).toHaveBeenCalledTimes(1);
  });

  it('disconnect during authentication never reserves or calls the provider', async () => {
    const gate = deferred<any>(); mocks.account.mockReturnValue(gate.promise);
    const call = invoke(); call.res.disconnect(); gate.resolve({ ok: true, uid: 'verified-user', email: null }); await call.done;
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(call.res.payload).toBeUndefined(); expect(call.res.listenerCount('close')).toBe(0);
  });

  it('disconnect while wallet reservation is in flight refunds the returned hold without inference', async () => {
    const gate = deferred<typeof HOLD>(); mocks.reserve.mockReturnValue(gate.promise);
    const call = invoke(); await vi.waitFor(() => expect(mocks.reserve).toHaveBeenCalledTimes(1));
    call.res.disconnect(); gate.resolve(HOLD); await call.done;
    expect(mocks.synthesize).not.toHaveBeenCalled(); expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, false);
    expect(mocks.scope).not.toHaveBeenCalled();
  });

  it('an already-expired reservation is refunded before entering paid scope or dispatching inference', async () => {
    const expired = { ...HOLD, expiresAt: Date.now() - 1 };
    mocks.reserve.mockResolvedValue(expired);
    const call = invoke(); await call.done;
    expect(call.res.code).toBe(503); expect(call.res.payload.code).toBe('unavailable');
    expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(expired, false);
  });

  it('disconnect during inference aborts its signal, ignores late audio and refunds', async () => {
    const gate = deferred<string>(); mocks.synthesize.mockReturnValue(gate.promise);
    const call = invoke(); await vi.waitFor(() => expect(mocks.synthesize).toHaveBeenCalledTimes(1));
    call.res.disconnect(); expect(mocks.synthesize.mock.calls[0][1].aborted).toBe(true);
    gate.resolve('late-audio'); await call.done;
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, false); expect(call.res.payload).toBeUndefined();
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
  });

  it('a response serialization failure refunds without leaving finish listeners attached', async () => {
    const res = response(false);
    res.json = () => { res.destroyed = true; throw new Error('synthetic serialization failure'); };
    await invoke({}, res).done;
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(HOLD, false);
    expect(res.listenerCount('finish')).toBe(0); expect(res.listenerCount('close')).toBe(0);
  });

  it('failed post-delivery settlement attempts a refund and does not generate the audio again', async () => {
    mocks.finish.mockRejectedValueOnce(new Error('commit failed')).mockResolvedValueOnce(false);
    const call = invoke(); await call.done;
    expect(mocks.finish.mock.calls).toEqual([[HOLD, true], [HOLD, false]]);
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(call.res.payload.audio).toBe('synthetic-audio');
    expect(mocks.audit).not.toHaveBeenCalledWith('VOICE_AI_GENERATED', expect.anything());
  });
});
