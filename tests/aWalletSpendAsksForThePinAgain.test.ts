// A WALLET SPEND ASKS FOR THE PIN AGAIN (admin 2026-10-11, Q-124: "wallet kharch par PIN dobara maango").
//
// The unlock ticket authorised EVERYTHING for five minutes, whichever screen the PIN was typed at — so
// unlocking Settings silently authorised a wallet recharge. THE CLASS: unlock(X) → access(Y). The ticket now
// carries the area it was opened at, SIGNED, and a money area opens only for a ticket opened at it (or at the
// Wallet & Billing screen that contains it). Every other area keeps the one-PIN behaviour. An older app,
// which names no area, gets an unscoped ticket and keeps working — nobody is stranded before the new bundle.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { mintUnlockTicket, verifyUnlockTicket, unlockSecret } from '../src/server/lib/vaultTicket';
import { ticketOpensArea, ticketAreaFrom, MONEY_AREAS } from '../src/lib/appLockAreas';

import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { emptyPinRecord, writePinRecord, afterOtpSent, hashPin } from '../src/server/lib/vaultPin';
import { UNLOCK_TICKET_HEADER } from '../src/server/lib/vaultTicketHttp';
const lockState = vi.hoisted(() => ({ record: null as Record<string, unknown> | null }));
vi.mock('../src/server/lib/serverDb', () => ({
  getServerDb: () => ({}), doc: () => ({}),
  getDoc: async () => ({ exists: () => lockState.record !== null, data: () => lockState.record }),
  runTransaction: async (_db: unknown, run: any) => run({
    get: async () => ({ exists: () => lockState.record !== null, data: () => lockState.record }),
    set: (_ref: unknown, record: Record<string, unknown>) => { lockState.record = record; },
  }),
}));
vi.mock('../src/server/lib/authMiddleware', () => ({
  requireUserMatch: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveAccountContact: async () => ({ email: 'synthetic@example.invalid', emailVerified: true, phone: null }),
  verifyFreshAuth: async () => null,
}));
vi.mock('../src/server/lib/vaultAudit', () => ({ auditVault: vi.fn() }));

const SECRET = 'test-secret';
const NOW = 1_800_000_000_000;

describe('the rule', () => {
  it('🔒 a Settings PIN no longer opens a money area; a money PIN does', () => {
    expect(ticketOpensArea('settings', 'wallet_recharge')).toBe(false);
    expect(ticketOpensArea('settings', 'subscription')).toBe(false);
    expect(ticketOpensArea('code_studio', 'billing')).toBe(false);
    expect(ticketOpensArea('wallet_recharge', 'wallet_recharge')).toBe(true);
    expect(ticketOpensArea('subscription', 'subscription')).toBe(true);
    // Wallet & Billing CONTAINS both money tabs, so a PIN typed at it opens them
    expect(ticketOpensArea('billing', 'wallet_recharge')).toBe(true);
    expect(ticketOpensArea('billing', 'subscription')).toBe(true);
    // …but a recharge PIN does not open plans, nor the reverse
    expect(ticketOpensArea('wallet_recharge', 'subscription')).toBe(false);
  });

  it('every other area keeps the one-PIN behaviour the admin chose on 2026-09-13', () => {
    for (const a of ['settings', 'code_studio', 'pro_builder', 'api_keys'] as const) {
      expect(ticketOpensArea('wallet_recharge', a)).toBe(true);
      expect(ticketOpensArea('settings', a)).toBe(true);
    }
    expect([...MONEY_AREAS].sort()).toEqual(['billing', 'subscription', 'wallet_recharge']);
  });

  it('an older app names no area and keeps working — its ticket is unscoped', () => {
    expect(ticketAreaFrom(undefined)).toBe('*');
    expect(ticketAreaFrom('made-up')).toBe('*');
    expect(ticketOpensArea('*', 'wallet_recharge')).toBe(true);
    expect(ticketOpensArea(undefined, 'wallet_recharge')).toBe(true);
  });
});

describe('the ticket carries the area, signed', () => {
  it('🔒 round-trips the area, and a relabelled area does not verify', () => {
    const t = mintUnlockTicket('u1', NOW, SECRET, 'pin', 'settings');
    expect(verifyUnlockTicket(t, 'u1', NOW + 1, SECRET)).toEqual({ method: 'pin', area: 'settings' });
    const forged = t.replace('.settings.', '.wallet_recharge.');
    expect(forged).not.toBe(t);
    expect(verifyUnlockTicket(forged, 'u1', NOW + 1, SECRET)).toBeNull();
  });

  it('a ticket minted before areas existed is read as unscoped, for its last few minutes', () => {
    // the old three-part shape, minted the way the module did before 2026-10-11
    const exp = NOW + 60_000;
    const sig = createHmac('sha256', SECRET).update(`navbharatai.vault.ticket.v1|u1|pin|${exp}`).digest('hex').slice(0, 48);
    expect(verifyUnlockTicket(`pin.${exp}.${sig}`, 'u1', NOW, SECRET)).toEqual({ method: 'pin', area: '*' });
  });
});

describe('the wiring', () => {
  it('all three successful handlers sign the requested area and a Settings ticket cannot spend wallet funds', async () => {
    const { registerAppLockRoutes } = await import('../src/server/routes/appLock');
    const { appLockBlocks } = await import('../src/server/lib/appLockEnforce');
    const handlers = captureRoutes(registerAppLockRoutes as any);
    const uid = 'synthetic-ticket-owner', pin = '8274', newPin = '3682', otp = '738194';
    for (const action of ['pin', 'unlock', 'pin/change']) {
      for (const area of ['settings', 'wallet_recharge']) {
        const now = Date.now();
        const base = { ...emptyPinRecord(), pinSalt: 'synthetic-salt', pinHash: hashPin(pin, 'synthetic-salt'), lockedAreas: ['api_keys', 'wallet_recharge'] };
        lockState.record = writePinRecord(action === 'pin' ? afterOtpSent(base, otp, 'reset', now) : base);
        const req = mockReq({ params: { userId: uid }, body: { pin, otp, currentPin: pin, newPin, area },
          headers: { [UNLOCK_TICKET_HEADER]: mintUnlockTicket(uid, now, unlockSecret(), 'pin', 'settings') } });
        const res = mockRes();
        await handlers.get('POST /api/app-lock/:userId/' + action)!(req, res);
        expect(res.statusCode, action + ':' + area).toBe(200);
        const ticket = res.body?.ticket;
        expect(typeof ticket).toBe('string');
        expect(verifyUnlockTicket(ticket, uid, Date.now(), unlockSecret())).toEqual({ method: 'pin', area });
        const spend = mockReq({ headers: { [UNLOCK_TICKET_HEADER]: ticket } });
        const refusal = await appLockBlocks(spend as any, uid, 'wallet-recharge');
        if (area === 'settings') expect(refusal?.status, action).toBe(401);
        else expect(refusal, action).toBeNull();
        // A successful handler's signed scope cannot be relabelled to bypass the money gate.
        if (area === 'settings') {
          const forged = ticket.replace('.settings.', '.wallet_recharge.');
          expect(verifyUnlockTicket(forged, uid, Date.now(), unlockSecret())).toBeNull();
        }
      }
    }
  });

  it('🔒 the gates ask it too, so a wallet gate after a Settings PIN shows the keypad instead of an open door', () => {
    const client = readFileSync('src/lib/appLock.ts', 'utf8');
    expect(client).toContain('if (area && !ticketOpensArea(unlockState?.area, area)) return null;');
    expect(client).toContain("jsonBody('POST', { pin, area })");
    const gate = readFileSync('src/components/AppLockGate.tsx', 'utf8');
    expect(gate).toContain('currentUnlock(userId, area)');
    expect(gate).toContain('unlockWithPin(userId, pin, area)');
  });
});
