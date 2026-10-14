// RESELL_AUTO_RENEW, PRIVATE_DB_EXPIRY_POLICY, FRONTEND_TRAFFIC_METER, PRIVATE_DB_COST_PLUS (2026-10-13).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeResellRenewal, computeResellAutoRenewToggle } from '../src/server/lib/hostingAddonLedger';
import { decideResellRow, decidePrivateDb, sweepResellAddons, type ResellRow } from '../src/server/lib/resellLifecycle';
import { resellAutoRenewEnabled, privateDbExpiryPolicyEnabled, privateDbDeleteAfterDays } from '../src/server/lib/purchaseAuditFlags';
import { edgeMeterEnabled, subForUrl, edgeDaySql, parseEdgeRows, readEdgeBytesForDay } from '../src/server/AgentV3/edgeTrafficMeter';
import { decideFrontendCharge } from '../src/server/AgentV3/hostingBillingSweep';
import {
  privateDbCostPlusEnabled, privateDbCostMultiplier, costPlusBreakdown, SUPABASE_UNIT_PRICES,
} from '../src/server/lib/privateDbCostPlus';
import { addonAgreementTerms, addonById, resellAutoRenewTerm, privateDbCostPlusTerm } from '../src/lib/hostingAddons';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T00:00:00.000Z');
const EXP = new Date(T0 + 30 * DAY).toISOString();
const row = (over: Partial<ResellRow> = {}): ResellRow => ({
  ref: 'srvabcdef12', addonId: 'server', purchasedAt: new Date(T0).toISOString(), expiresAt: EXP,
  agreedAt: new Date(T0).toISOString(), proof: 'ws:workspace-abc123:https://x.run.app',
  autoRenew: true, autoRenewAgreedAt: new Date(T0).toISOString(), ...over,
} as ResellRow);
const wallet = (r: ResellRow, balance = 100_000) => ({ tokenBalance: balance, giftTokensRemaining: 0, hostingAddons: [r] });
const at = (ms: number) => new Date(ms).toISOString();

afterEach(() => {
  for (const k of ['RESELL_AUTO_RENEW', 'PRIVATE_DB_EXPIRY_POLICY', 'PRIVATE_DB_DELETE_AFTER_DAYS', 'FRONTEND_TRAFFIC_METER',
    'CF_ACCOUNT_ID', 'CF_ANALYTICS_TOKEN', 'PRIVATE_DB_COST_PLUS', 'PRIVATE_DB_COST_MULTIPLIER']) delete process.env[k];
});

describe('flags default OFF', () => {
  it('every new flag is off unless set', () => {
    expect(resellAutoRenewEnabled()).toBe(false);
    expect(privateDbExpiryPolicyEnabled()).toBe(false);
    expect(edgeMeterEnabled()).toBe(false);
    expect(privateDbCostPlusEnabled()).toBe(false);
    expect(privateDbDeleteAfterDays()).toBe(7);
    expect(privateDbCostMultiplier()).toBe(1.5);
    process.env.FRONTEND_TRAFFIC_METER = 'on';
    expect(edgeMeterEnabled()).toBe(false); // still needs the Cloudflare account + token
  });
});

describe('auto-renew', () => {
  it('reminds 5/3/1 days ahead and renews from 12h before expiry', () => {
    const exp = T0 + 30 * DAY;
    expect(decideResellRow(row(), exp - 4.5 * DAY, true)).toEqual({ kind: 'remind', days: 5 });
    expect(decideResellRow(row(), exp - 0.8 * DAY, true)).toEqual({ kind: 'remind', days: 1 });
    expect(decideResellRow(row(), exp - 6 * 3600_000, true)).toEqual({ kind: 'renew' });
    expect(decideResellRow(row(), exp + 3 * DAY, true)).toEqual({ kind: 'lapse' });
  });

  it('one debit per period: a re-run with the same expiry is refused', () => {
    const now = at(T0 + 30 * DAY - 3600_000);
    const a = computeResellRenewal(wallet(row()), 'srvabcdef12', EXP, now);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.chargedInr).toBe(149);
    expect(Date.parse(a.row.expiresAt)).toBe(T0 + 60 * DAY);
    expect(a.wallet.tokenBalance).toBeLessThan(100_000);
    expect(computeResellRenewal(a.wallet, 'srvabcdef12', EXP, now)).toEqual({ ok: false, reason: 'already' });
  });

  it('off / no consent / too early / too late / no money never charge', () => {
    const now = at(T0 + 30 * DAY - 3600_000);
    expect(computeResellRenewal(wallet(row({ autoRenew: false })), 'srvabcdef12', EXP, now)).toMatchObject({ reason: 'off' });
    expect(computeResellRenewal(wallet(row({ autoRenewAgreedAt: undefined })), 'srvabcdef12', EXP, now)).toMatchObject({ reason: 'off' });
    expect(computeResellRenewal(wallet(row()), 'srvabcdef12', EXP, at(T0 + 20 * DAY))).toMatchObject({ reason: 'not_due' });
    expect(computeResellRenewal(wallet(row()), 'srvabcdef12', EXP, at(T0 + 34 * DAY))).toMatchObject({ reason: 'too_late' });
    expect(computeResellRenewal(wallet(row(), 1), 'srvabcdef12', EXP, now)).toMatchObject({ reason: 'insufficient' });
  });

  it('toggle: off any time, on only with the terms ticked', () => {
    const w = wallet(row());
    const off = computeResellAutoRenewToggle(w, 'srvabcdef12', false, false, at(T0));
    expect(off.ok && off.wallet.hostingAddons[0].autoRenew).toBe(false);
    expect(computeResellAutoRenewToggle(w, 'srvabcdef12', true, false, at(T0))).toEqual({ ok: false, reason: 'agreement_required' });
  });

  it('sweep: insufficient balance tells the user and leaves the row for grace', async () => {
    const notes: string[] = [];
    const rep = await sweepResellAddons({
      autoRenewEnabled: true, priceOf: () => 149,
      renewRow: async () => ({ result: 'insufficient' }),
      listWallets: async () => [{ id: 'u1', data: wallet(row()) }],
      patchRow: async () => true, notify: async (_u, m) => notes.push(m),
      teardownServer: async () => ({ ok: true }), now: () => T0 + 30 * DAY + 3600_000,
    });
    expect(rep.renewShort).toBe(1);
    expect(notes.length).toBe(1);
  });

  it('terms disclose renewal and how to turn it off', () => {
    const t = resellAutoRenewTerm(addonById('server')!);
    expect(t).toMatch(/30 days/);
    expect(t.toLowerCase()).toMatch(/turn it off|off/);
  });
});

describe('private database expiry policy', () => {
  const lapsed = row({ addonId: 'dedicated_db', proof: 'db:workspace-abc123:abcdefghijkl', lapsedAt: at(T0 + 33 * DAY) } as never);
  const exp = T0 + 30 * DAY;
  it('pausable org → pause once', () => {
    expect(decidePrivateDb(lapsed, exp + 3 * DAY, { pausable: true, deleteAfterDays: 7 })).toEqual({ kind: 'pause' });
    expect(decidePrivateDb({ ...lapsed, pausedAt: at(exp) } as ResellRow, exp + 3 * DAY, { pausable: true, deleteAfterDays: 7 })).toBeNull();
  });
  it('paid org → warn 3 days, 1 day, then delete at +7 days', () => {
    const p = { pausable: false, deleteAfterDays: 7 };
    expect(decidePrivateDb(lapsed, exp + 4.5 * DAY, p)).toMatchObject({ kind: 'warn', daysLeft: 3 });
    expect(decidePrivateDb(lapsed, exp + 6.5 * DAY, p)).toMatchObject({ kind: 'warn', daysLeft: 1 });
    expect(decidePrivateDb(lapsed, exp + 7 * DAY, p)).toEqual({ kind: 'delete' });
  });
  it('terms disclose it', () => {
    expect(addonAgreementTerms(addonById('dedicated_db')!).join(' ')).toMatch(/deleted 7 days/);
  });
});

describe('frontend traffic meter', () => {
  it('maps the published URL to its edge subdomain', () => {
    expect(subForUrl('https://v3-abc-123.mitrify.in/')).toBe('v3-abc-123');
    expect(subForUrl('not a url')).toBeNull();
  });
  it('only a validated day reaches the SQL', () => {
    expect(edgeDaySql("2026-10-01' OR 1=1", 'nbai_traffic')).toBeNull();
    expect(edgeDaySql('2026-10-01', 'nbai_traffic')).toMatch(/_sample_interval/);
  });
  it('parses and sums rows; a wrong shape is null', () => {
    expect(parseEdgeRows({ data: [{ sub: 'a', bytes: 5 }, { sub: 'a', bytes: 2 }] })?.get('a')).toBe(7);
    expect(parseEdgeRows({ nope: 1 })).toBeNull();
  });
  it('reads via the CF API when on; unreadable → null (nothing charged)', async () => {
    const env = { FRONTEND_TRAFFIC_METER: 'on', CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 't' } as NodeJS.ProcessEnv;
    const ok = await readEdgeBytesForDay('2026-10-01', env, (async () => new Response(JSON.stringify({ data: [{ sub: 's', bytes: 9 }] }))) as never);
    expect(ok?.get('s')).toBe(9);
    const bad = await readEdgeBytesForDay('2026-10-01', env, (async () => new Response('x', { status: 500 })) as never);
    expect(bad).toBeNull();
  });
  it('₹20/GB only past the allowance, only what was not billed before, only with billing on', () => {
    const base = { includedGb: 15, agreed: true, billingEnabled: true };
    expect(decideFrontendCharge({ ...base, gbToday: 1, record: { frontendGb: 10 } }).charge).toBe(false);
    const c = decideFrontendCharge({ ...base, gbToday: 2, record: { frontendGb: 14 } });
    expect(c.charge).toBe(true);
    expect(c.billableGb).toBeCloseTo(1, 6);
    expect(c.inr).toBeCloseTo(20, 2);
    const again = decideFrontendCharge({ ...base, gbToday: 1, record: { frontendGb: 16, frontendGbBilled: 1 } });
    expect(again.billableGb).toBeCloseTo(1, 6);
    expect(decideFrontendCharge({ ...base, billingEnabled: false, gbToday: 2, record: { frontendGb: 14 } }).charge).toBe(false);
    expect(decideFrontendCharge({ ...base, agreed: false, gbToday: 2, record: { frontendGb: 14 } }).charge).toBe(false);
  });
  it('the Worker meters every response path and is a no-op without the binding', () => {
    const w = readFileSync(join(__dirname, '..', 'infra/cloudflare/mitrify-apps-worker.js'), 'utf8');
    expect((w.match(/return meter\(env, sub,/g) ?? []).length).toBe(4);
    expect(w).toMatch(/if \(!env \|\| !env\.NBAI_TRAFFIC/);
  });
});

describe('private database cost-plus', () => {
  it('Micro + 8 GB stays within the ₹1,499 minimum', () => {
    const b = costPlusBreakdown({ computeSize: 'micro', hours: 720, diskGb: 8, egressGb: 0 }, 1.5, 85);
    expect(b.costUsd).toBeCloseTo(9.68, 2);
    expect(b.extraInr).toBe(0);
  });
  it('a bigger project pays only the part above ₹1,499', () => {
    const b = costPlusBreakdown({ computeSize: 'small', hours: 720, diskGb: 58, egressGb: 0 }, 1.5, 85);
    expect(b.costPlusInr).toBeGreaterThan(1499);
    expect(b.extraInr).toBeCloseTo(b.costPlusInr - 1499, 2);
    expect(b.lines.length).toBe(5);
  });
  it('multiplier env is clamped to [1,5]', () => {
    process.env.PRIVATE_DB_COST_MULTIPLIER = '0.5';
    expect(privateDbCostMultiplier()).toBe(1.5);
    process.env.PRIVATE_DB_COST_MULTIPLIER = '2';
    expect(privateDbCostMultiplier()).toBe(2);
  });
  it('unit prices are flagged for verification', () => {
    expect(SUPABASE_UNIT_PRICES.needsVerification).toBe(true);
  });
  it('renewal charges the extra as its own line, once', () => {
    const r = row({ addonId: 'dedicated_db', ref: 'dbabcdef12', proof: 'db:workspace-abc123:abcdefghijkl' } as never);
    const now = at(T0 + 30 * DAY - 3600_000);
    const o = computeResellRenewal(wallet(r, 1_000_000), 'dbabcdef12', EXP, now, { extraInr: 300, note: 'x' });
    expect(o.ok && o.chargedInr).toBe(1799);
    expect(privateDbCostPlusTerm(1.5)).toMatch(/× 1.5/);
  });
});

describe('gift money never renews', () => {
  it('a wallet that is all welcome gift is refused as gift_only', () => {
    const now = new Date(T0 + 30 * DAY - 3600_000).toISOString();
    const w = { tokenBalance: 100_000, giftTokensRemaining: 100_000, hostingAddons: [row()] };
    expect(computeResellRenewal(w, 'srvabcdef12', EXP, now)).toMatchObject({ ok: false, reason: 'gift_only' });
  });
});
