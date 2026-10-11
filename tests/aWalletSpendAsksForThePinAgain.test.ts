// A WALLET SPEND ASKS FOR THE PIN AGAIN (admin 2026-10-11, Q-124: "wallet kharch par PIN dobara maango").
//
// The unlock ticket authorised EVERYTHING for five minutes, whichever screen the PIN was typed at — so
// unlocking Settings silently authorised a wallet recharge. THE CLASS: unlock(X) → access(Y). The ticket now
// carries the area it was opened at, SIGNED, and a money area opens only for a ticket opened at it (or at the
// Wallet & Billing screen that contains it). Every other area keeps the one-PIN behaviour. An older app,
// which names no area, gets an unscoped ticket and keeps working — nobody is stranded before the new bundle.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { mintUnlockTicket, verifyUnlockTicket } from '../src/server/lib/vaultTicket';
import { ticketOpensArea, ticketAreaFrom, MONEY_AREAS } from '../src/lib/appLockAreas';

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
  it('🔒 the money routes ask the same rule, and the unlock routes sign the area they were sent', () => {
    const enforce = readFileSync('src/server/lib/appLockEnforce.ts', 'utf8');
    expect(enforce).toContain('return ticket && ticketOpensArea(ticket.area, area) ? null : lockedRefusal(action);');
    const routes = readFileSync('src/server/routes/appLock.ts', 'utf8');
    expect(routes.match(/mintUnlockTicket\(userId, now, unlockSecret\(\), 'pin', ticketAreaFrom\(req\.body\?\.area\)\)/g)?.length).toBe(3);
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
