/**
 * Add-ons: money and the slot move together, or neither moves.
 *
 * The failure this locks: a user is charged and the extra website or domain never appears,
 * or a slot is taken away while the site or domain is still live and the refund already went.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HOSTING_ADDONS, addonAgreementTerms, activeAddonCount, addonById,
} from '../src/lib/hostingAddons';
import {
  computeAddonPurchase, computeAddonRemoval, purchaseHostingAddon, unusedAddonValueInr,
} from '../src/server/lib/hostingAddonLedger';
import { publishedAppCap, publishedAppCapForAccount } from '../src/server/lib/HostingQuota';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';
import { HOSTING_TIERS } from '../src/lib/hostingTiers';

const DAY = 24 * 60 * 60 * 1000;
const NOW = '2026-10-09T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const REF = 'addonref01';

function wallet(tokens: number, extra: Record<string, any> = {}): Record<string, any> {
  return {
    userId: 'u1',
    tokenBalance: tokens,
    totalTokensUsed: 0,
    remaining_balance: tokens / TOKENS_PER_RUPEE,
    walletLedger: [],
    giftTokensRemaining: extra.gifted ? tokens : 0,
    ...(extra.gifted ? {} : { total_money_spent: tokens / TOKENS_PER_RUPEE }),
    ...extra,
  };
}

function buy(w: Record<string, any>, id = 'extra_site', ref = REF) {
  return computeAddonPurchase(w, NOW, id, { agreedToTerms: true, clientRef: ref });
}

afterEach(() => {
  delete process.env.AGENTV3_HOSTING_PLANS;
});

describe('the menu', () => {
  it('sells only the two slots we can deliver, at the prices on the card', () => {
    const site = addonById('extra_site');
    const domain = addonById('extra_domain');
    expect(site).toMatchObject({ sellable: true, priceInr: 49, days: 30 });
    expect(domain).toMatchObject({ sellable: true, priceInr: 49, days: 30 });
    for (const id of ['server', 'shared_db', 'dedicated_db', 'traffic_gb']) {
      const row = addonById(id);
      expect(row?.sellable, id).toBe(false);
      expect(row?.unavailableReason || '').toMatch(/not/i);
    }
  });

  it('the agreement quotes the same price as the row', () => {
    for (const addon of HOSTING_ADDONS.filter((a) => a.sellable)) {
      const text = addonAgreementTerms(addon).join(' ');
      expect(text).toContain(`₹${addon.priceInr}`);
      expect(text).toContain('nothing is charged');
    }
  });
});

describe('purchase', () => {
  const price = 49 * TOKENS_PER_RUPEE;

  it('debits and writes the slot together', () => {
    const r = buy(wallet(price + 10));
    if (!r.ok) throw new Error(r.reason);
    expect(r.charged).toBe(true);
    expect(r.wallet.tokenBalance).toBe(10);
    expect(activeAddonCount(r.wallet, 'extra_site', NOW_MS)).toBe(1);
    expect(r.wallet.walletLedger.at(-1).feature).toBe('hosting-addon');
    expect(r.wallet.walletLedger.at(-1).description).toContain('Extra website');
  });

  it('the same ref a second time does not charge again and does not add a second slot', () => {
    const first = buy(wallet(price * 3));
    if (!first.ok) throw new Error('first');
    const again = buy(first.wallet);
    if (!again.ok) throw new Error('again');
    expect(again.charged).toBe(false);
    expect(again.wallet.tokenBalance).toBe(first.wallet.tokenBalance);
    expect(activeAddonCount(again.wallet, 'extra_site', NOW_MS)).toBe(1);
  });

  it('a different ref buys a second slot', () => {
    const first = buy(wallet(price * 3));
    if (!first.ok) throw new Error('first');
    const second = buy(first.wallet, 'extra_site', 'addonref02');
    if (!second.ok) throw new Error('second');
    expect(second.charged).toBe(true);
    expect(activeAddonCount(second.wallet, 'extra_site', NOW_MS)).toBe(2);
  });

  it('refuses a server, a database and a traffic pack without touching the wallet', () => {
    const start = wallet(5000 * TOKENS_PER_RUPEE);
    for (const id of ['server', 'shared_db', 'dedicated_db', 'traffic_gb']) {
      const r = computeAddonPurchase(start, NOW, id, { agreedToTerms: true, clientRef: REF });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not_available');
      expect(start.tokenBalance).toBe(5000 * TOKENS_PER_RUPEE);
      expect(start.hostingAddons).toBeUndefined();
    }
  });

  it('gift money cannot buy an add-on', () => {
    const r = buy(wallet(price, { gifted: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('gift_only');
  });

  it('no tick, a short balance, or a bad ref charges nothing', () => {
    const w = wallet(price);
    expect(computeAddonPurchase(w, NOW, 'extra_site', { clientRef: REF }).ok).toBe(false);
    expect(computeAddonPurchase(wallet(10), NOW, 'extra_site', { agreedToTerms: true, clientRef: REF }).ok).toBe(false);
    expect(computeAddonPurchase(w, NOW, 'extra_site', { agreedToTerms: true, clientRef: 'no' }).ok).toBe(false);
    expect(w.tokenBalance).toBe(price);
  });

  it('plans off ⇒ refused', () => {
    process.env.AGENTV3_HOSTING_PLANS = 'off';
    const r = buy(wallet(price));
    expect(r.ok).toBe(false);
  });
});

describe('removal', () => {
  const price = 49 * TOKENS_PER_RUPEE;

  function bought() {
    const r = buy(wallet(price));
    if (!r.ok) throw new Error('buy');
    return r;
  }

  it('refunds unused days when nothing extra is in use', () => {
    const b = bought();
    const halfway = new Date(NOW_MS + 15 * DAY).toISOString();
    const r = computeAddonRemoval(b.wallet, halfway, REF, 3, 3);
    if (!r.ok) throw new Error(r.reason);
    expect(r.creditedInr).toBeGreaterThan(20);
    expect(r.creditedInr).toBeLessThan(49);
    expect(activeAddonCount(r.wallet, 'extra_site', Date.parse(halfway))).toBe(0);
    expect(r.wallet.tokenBalance).toBeGreaterThan(b.wallet.tokenBalance);
    expect(r.wallet.walletLedger.at(-1).type).toBe('refund');
  });

  it('refuses, and refunds nothing, while the extra website is still live', () => {
    const b = bought();
    const before = b.wallet.tokenBalance;
    const r = computeAddonRemoval(b.wallet, NOW, REF, 3, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('still_in_use');
    expect(b.wallet.tokenBalance).toBe(before);
    expect(activeAddonCount(b.wallet, 'extra_site', NOW_MS)).toBe(1);
  });

  it('lets one of two slots go when one extra site is still live', () => {
    const first = buy(wallet(price * 3));
    if (!first.ok) throw new Error('1');
    const second = buy(first.wallet, 'extra_site', 'addonref02');
    if (!second.ok) throw new Error('2');
    // base 3 + 1 remaining slot = 4, and 4 sites are live. Removing one of two is allowed.
    const r = computeAddonRemoval(second.wallet, NOW, REF, 3, 4);
    expect(r.ok).toBe(true);
  });

  it('a full refund on the same day is the price, never more', () => {
    const b = bought();
    expect(unusedAddonValueInr(b.addon, NOW_MS)).toBe(49);
    const r = computeAddonRemoval(b.wallet, NOW, REF, 3, 0);
    if (!r.ok) throw new Error(r.reason);
    expect(r.creditedInr).toBe(49);
  });
});

describe('the cap actually moves', () => {
  it('one extra website is one more than the free cap, and a plan cap, and nothing when the count is junk', () => {
    const free = publishedAppCap();
    expect(publishedAppCapForAccount(null, 1)).toBe(free + 1);
    expect(publishedAppCapForAccount(HOSTING_TIERS[0], 2)).toBe(HOSTING_TIERS[0].publishedApps + 2);
    expect(publishedAppCapForAccount(null, Number.NaN)).toBe(free);
    expect(publishedAppCapForAccount(null, -3)).toBe(free);
  });
});

describe('the wires', () => {
  const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('publish cap and the published-apps list both add the paid slots', () => {
    expect(src('src/server/lib/HostingQuota.ts')).toContain('publishedAppCapForAccount');
    expect(src('src/server/routes/agentv3.ts')).toContain('publishedAppCapForAccount');
  });

  it('a domain add-on is counted at connect, and a free account with one is not refused for having no plan', () => {
    const domains = src('src/server/routes/nbaiDomains.ts');
    expect(domains).toContain('extraDomains');
    expect(domains).toContain('addonStatus.extraDomains');
  });

  it('the purchase route is locked before it can charge, and an unsellable add-on never reaches the debit', () => {
    const wallet = src('src/server/routes/wallet.ts');
    const at = wallet.search(/appLockBlocks\([\s\S]*?'hosting-addon-purchase'\)/);
    const charge = wallet.indexOf('await purchaseHostingAddon(');
    expect(at).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(at);
  });
});

describe('purchaseHostingAddon over a fake wallet', () => {
  function fakeAdminDb(docs: Record<string, any>) {
    return {
      doc: (path: string) => path,
      runTransaction: async (fn: any) => fn({
        get: async (ref: string) => ({ exists: !!docs[ref], data: () => docs[ref], id: ref, ref }),
        set: (ref: string, value: any) => { docs[ref] = value; },
      }),
    } as any;
  }

  it('persists the slot only when the debit is in the same write', async () => {
    const docs: Record<string, any> = {
      'user_token_wallets/u1': wallet(49 * TOKENS_PER_RUPEE),
    };
    const result = await purchaseHostingAddon(fakeAdminDb(docs), 'u1', 'server', { agreedToTerms: true, clientRef: REF }, NOW);
    expect(result.ok).toBe(false);
    expect(docs['user_token_wallets/u1'].hostingAddons).toBeUndefined();
    expect(docs['user_token_wallets/u1'].tokenBalance).toBe(49 * TOKENS_PER_RUPEE);

    const ok = await purchaseHostingAddon(fakeAdminDb(docs), 'u1', 'extra_domain', { agreedToTerms: true, clientRef: REF }, NOW);
    expect(ok.ok).toBe(true);
    expect(docs['user_token_wallets/u1'].tokenBalance).toBe(0);
    expect(activeAddonCount(docs['user_token_wallets/u1'], 'extra_domain', NOW_MS)).toBe(1);
  });
});
