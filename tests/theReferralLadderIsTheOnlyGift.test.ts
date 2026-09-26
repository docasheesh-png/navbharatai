/**
 * THE REFERRAL LADDER IS THE ONLY WELCOME CREDIT (admin 2026-09-26, verbatim: "100*4 ko chor ke sab
 * hata do").
 *
 * Before this date the code carried SIX ways of giving a new account money, most of them switched off
 * by a flag or a hardcoded `false` rather than removed: the legacy flat bonus (`welcomeBonus.ts`), the
 * ₹250/₹500 v2 plan with its phone-bonus claim (`giftPlan.ts`, `/claim-phone-bonus`), the weekly
 * top-up ladder (`weeklyTopUp.ts`), the ₹50 interim credit (`interimWelcomeGift.ts`), the switch that
 * made them stand down for the ladder (`welcomeGiftExclusion.ts`), and the ₹250 backfill. All of it is
 * deleted. A new wallet opens at ₹0, and ₹100 × 4 through the referral steps is the one thing left.
 *
 * This suite fails if any of those doors comes back — and, just as much, if the sweep went too far and
 * took the referral ladder with it.
 *
 * ⚠️ It mocks `serverDb` module-wide so the real wallet route can run against an in-memory store;
 * that is why it lives in its own file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const store = new Map<string, Record<string, unknown>>();

vi.mock('../src/server/lib/serverDb', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const snap = (path: string) => ({
    exists: () => store.has(path),
    data: () => (store.has(path) ? { ...store.get(path)! } : undefined),
  });
  return {
    ...real,
    getServerDb: () => ({}),
    doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
    getDoc: async (ref: { path: string }) => snap(ref.path),
    setDoc: async (ref: { path: string }, data: Record<string, unknown>) => { store.set(ref.path, { ...store.get(ref.path), ...data }); },
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const staged: Array<() => void> = [];
      const out = await fn({
        get: async (ref: { path: string }) => snap(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>) => { staged.push(() => store.set(ref.path, { ...data })); },
        update: (ref: { path: string }, data: Record<string, unknown>) => { staged.push(() => store.set(ref.path, { ...store.get(ref.path), ...data })); },
      });
      for (const w of staged) w();
      return out;
    },
  };
});

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOf = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...filesUnder(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

/** Register the real wallet routes onto a recorder, and hand back the GET handler. */
async function walletGet() {
  const routes: Record<string, (req: unknown, res: unknown) => Promise<unknown>> = {};
  const record = (method: string) => (path: string, ...handlers: Array<(req: unknown, res: unknown) => Promise<unknown>>) => {
    routes[`${method} ${path}`] = handlers[handlers.length - 1];
  };
  const app = { get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE'), patch: record('PATCH') };
  const { registerWalletRoutes } = await import('../src/server/routes/wallet');
  registerWalletRoutes(app as never);
  return routes;
}

async function openWallet(routes: Record<string, (req: unknown, res: unknown) => Promise<unknown>>, userId: string) {
  let body: Record<string, unknown> = {};
  let status = 200;
  const res = {
    status(code: number) { status = code; return res; },
    json(b: Record<string, unknown>) { body = b; return res; },
  };
  await routes['GET /api/wallet/:userId']({ params: { userId }, query: { email: `${userId}@example.com`, name: 'N' }, headers: {} }, res);
  return { status, body };
}

describe('a brand-new wallet opens at ₹0', () => {
  beforeEach(() => store.clear());

  it('credits nothing, writes no welcome row and no welcome receipt', async () => {
    const routes = await walletGet();
    const { status, body } = await openWallet(routes, 'u1');
    expect(status).toBe(200);
    expect(body.tokenBalance).toBe(0);
    expect(body.remaining_balance).toBe(0);
    expect(body.walletLedger).toEqual([]);
    expect(body.freeGiftedTokens).toBe(0);
    expect(body.giftTokensRemaining).toBe(0);
    // The response no longer describes a gift programme that does not exist.
    expect(body).not.toHaveProperty('freeGift');
    // The only document written is the wallet itself — no `payment_transactions/welcome_<uid>`.
    expect([...store.keys()]).toEqual(['user_token_wallets/u1']);
  });

  it('holds with the retired flags SET — a stale Cloud Run key cannot bring a grant back', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      WALLET_GIFT_V2: 'on', WELCOME_BONUS_TOKENS: '50000', INTERIM_WELCOME_TOKENS: '5000',
      WEEKLY_TOPUP_TOKENS: '20000', REFERRAL_REWARDS: '',
    });
    try {
      const routes = await walletGet();
      const { body } = await openWallet(routes, 'u2');
      expect(body.tokenBalance).toBe(0);
    } finally {
      process.env = saved;
    }
  });

  it('an existing wallet is served as it is — nothing is added on a later read', async () => {
    store.set('user_token_wallets/u3', {
      tokenBalance: 1234, totalTokensPurchased: 1234, totalTokensUsed: 0, walletLedger: [],
      createdAt: '2026-01-01T00:00:00.000Z', lastWeeklyTopUpAt: '2026-01-01T00:00:00.000Z', freeGiftedTokens: 0,
    });
    const routes = await walletGet();
    const { body } = await openWallet(routes, 'u3');
    expect(body.tokenBalance).toBe(1234);
    expect(store.get('user_token_wallets/u3')!.tokenBalance).toBe(1234);
  });

  it('the phone-bonus claim route is gone', async () => {
    const routes = await walletGet();
    expect(Object.keys(routes).some((k) => k.includes('claim-phone-bonus'))).toBe(false);
  });
});

describe('the retired grants are gone from the code, not just switched off', () => {
  const GONE = [
    'src/server/lib/welcomeBonus.ts',
    'src/server/lib/giftPlan.ts',
    'src/server/lib/weeklyTopUp.ts',
    'src/server/lib/interimWelcomeGift.ts',
    'src/server/lib/welcomeGiftExclusion.ts',
    'src/server/lib/welcomeBackfill.ts',
    'src/components/panels/FreeGiftBanner.tsx',
    'src/components/panels/PhoneBonusCard.tsx',
  ];

  it('the modules and cards no longer exist', () => {
    for (const f of GONE) expect(existsSync(join(root, f)), f).toBe(false);
  });

  it('nothing in the app imports them or calls the claim route', () => {
    const hits = [...filesUnder('src'), 'server.ts']
      .filter((f) => /(welcomeBonus|giftPlan|weeklyTopUp|interimWelcomeGift|welcomeGiftExclusion|welcomeBackfill|FreeGiftBanner|PhoneBonusCard)'/.test(codeOf(f))
        || codeOf(f).includes('claim-phone-bonus'));
    expect(hits).toEqual([]);
  });

  it('the retired-bonus size is read ONLY to understand old wallets in a merge', () => {
    // `welcomeBonusTokens` survives in payments.ts because a merge has to know how much of an OLD
    // wallet was a gift rather than a purchase. Any other reader would be a grant coming back.
    const readers = filesUnder('src')
      .filter((f) => f !== 'src/server/lib/payments.ts' && !f.endsWith('.test.ts'))
      .filter((f) => /\bwelcomeBonusTokens\(/.test(codeOf(f)));
    expect(readers).toEqual(['src/server/lib/accountMerge.ts']);
  });

  it('no AI tells a user about a welcome, weekly or phone bonus', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).not.toMatch(/credits your wallet with \\u20b950/);
    expect(kb).not.toMatch(/NOT SWITCHED ON YET/);
    expect(kb).toMatch(/a new account opens with a \\u20b90 balance/);
  });
});

describe('the referral ladder is still there — the sweep did not go too far', () => {
  it('its rules, its claim route, its panel and its admin card all remain', () => {
    expect(existsSync(join(root, 'src/server/lib/referralRewards.ts'))).toBe(true);
    const route = read('src/server/routes/referral.ts');
    expect(route).toContain("app.post('/api/referral/:userId/claim'");
    expect(route).toContain("app.post('/api/referral/:userId/redeem'");
    expect(existsSync(join(root, 'src/components/panels/ReferralPanel.tsx'))).toBe(true);
    expect(read('src/components/AdminDashboard.tsx')).toContain('<ReferralCostCard');
  });

  it('still pays ₹100 a step, capped at ₹400', async () => {
    const { decideSelfReward } = await import('../src/server/lib/referralRewards');
    const { MAX_SELF_GIFT_TOKENS } = await import('../src/server/lib/giftPolicy');
    const r = decideSelfReward({
      step: 'email', alreadyPaidSteps: [], deviceVerified: true, platform: 'android',
      alreadyGiftedTokens: 0, env: { REFERRAL_REWARDS: 'on' },
    });
    expect(r.tokens).toBe(100 * 100);
    expect(MAX_SELF_GIFT_TOKENS).toBe(400 * 100);
  });
});
