// Roadmap breadth — gift cards / store credit starter (a packaged domain vertical).
//
// Prepaid gift cards / store credit for ecommerce. The real feature is BALANCE INTEGRITY: a card is issued with
// a monetary balance in INTEGER minor units (paise/cents), redeeming DEBITS the balance atomically and can
// NEVER overdraw (a redemption for more than the remaining balance is rejected; a partial redemption leaves the
// exact remainder), and the sum of every redemption plus the remaining balance always equals the original
// amount. Codes are unique (node:crypto), a card can be deactivated, and an expired card cannot be redeemed.
// This emits a dependency-free GiftCardService + an Express router + a README. Real logic, not a stub — the
// no-overdraw + exact-remainder rules are unit-tested against the emitted code. Pure builder → the caller writes
// the files. Distinct from generate_coupons (a discount, not a stored balance) and generate_loyalty (earned points).

export const GIFTCARDS_SERVICE_SOURCE = `import { randomBytes } from 'node:crypto';

// Gift-card / store-credit domain logic. The core guarantees: (1) a card holds a monetary balance in INTEGER
// minor units (paise/cents); (2) redeem() DEBITS atomically and can NEVER overdraw — a redemption exceeding the
// remaining balance is rejected, a partial redemption leaves the EXACT remainder; and (3) sum(redemptions) +
// balance === original amount, always. In-memory here; swap the Map for your database.

export interface Redemption { amountMinor: number; at: string; note: string }

export interface GiftCard {
  code: string;
  originalMinor: number;
  balanceMinor: number;
  currency: string;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
  redemptions: Redemption[];
}

// Unambiguous alphabet (no 0/O/1/I) for human-readable codes, grouped like ABCD-EFGH-JKLM.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode(): string {
  const bytes = randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) raw += ALPHABET[bytes[i] % ALPHABET.length];
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
}

export class GiftCardService {
  private cards = new Map<string, GiftCard>();

  /** Issue a gift card for an amount (integer minor units). Optional currency + expiry. Unique code. */
  issue(amountMinor: number, opts: { currency?: string; expiresAt?: string | null } = {}, now: Date = new Date()): GiftCard {
    const amount = Math.floor(Number(amountMinor));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be a positive integer (minor units)');
    let code = randomCode();
    while (this.cards.has(code)) code = randomCode(); // guarantee uniqueness
    const card: GiftCard = {
      code,
      originalMinor: amount,
      balanceMinor: amount,
      currency: String(opts.currency ?? 'INR').trim().toUpperCase() || 'INR',
      active: true,
      expiresAt: opts.expiresAt ? new Date(opts.expiresAt).toISOString() : null,
      createdAt: now.toISOString(),
      redemptions: [],
    };
    this.cards.set(code, card);
    return this.get(code) as GiftCard;
  }

  get(code: string): GiftCard | undefined {
    const c = this.cards.get(String(code ?? '').trim().toUpperCase());
    if (!c) return undefined;
    return { ...c, redemptions: c.redemptions.map((r) => ({ ...r })) };
  }

  /** Remaining balance, or null if the code is unknown. */
  balance(code: string): number | null {
    const c = this.cards.get(String(code ?? '').trim().toUpperCase());
    return c ? c.balanceMinor : null;
  }

  private isRedeemable(card: GiftCard | undefined, now: Date): card is GiftCard {
    if (!card || !card.active) return false;
    if (card.expiresAt && new Date(card.expiresAt).getTime() <= now.getTime()) return false;
    return true;
  }

  /**
   * Redeem an amount against the card. DEBITS the balance and can never overdraw — throws if the card is
   * unknown/inactive/expired, or if the amount exceeds the remaining balance. Returns the updated card.
   */
  redeem(code: string, amountMinor: number, note = '', now: Date = new Date()): GiftCard {
    const c = this.cards.get(String(code ?? '').trim().toUpperCase());
    if (!this.isRedeemable(c, now)) throw new Error('card is not redeemable (unknown, inactive or expired)');
    const amount = Math.floor(Number(amountMinor));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('redeem amount must be a positive integer');
    if (amount > c.balanceMinor) throw new Error('insufficient balance');
    c.balanceMinor -= amount; // atomic debit — never below zero (guarded above)
    c.redemptions.push({ amountMinor: amount, at: now.toISOString(), note: String(note ?? '') });
    return this.get(code) as GiftCard;
  }

  /** Enable/disable a card without deleting it. */
  setActive(code: string, active: boolean): GiftCard {
    const c = this.cards.get(String(code ?? '').trim().toUpperCase());
    if (!c) throw new Error('card not found');
    c.active = Boolean(active);
    return this.get(c.code) as GiftCard;
  }

  /** All cards, newest first. */
  list(): GiftCard[] {
    return [...this.cards.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((c) => ({ ...c, redemptions: c.redemptions.map((r) => ({ ...r })) }));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const giftCards = new GiftCardService();
`;

export const GIFTCARDS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { giftCards } from './giftCardService';

// REST endpoints for gift cards. Mount with: app.use('/api/gift-cards', giftCardRouter).
// Guard the issue + list routes with admin auth; the balance check can be public (code acts as the secret).
export const giftCardRouter = Router();

// Issue a card. { amountMinor, currency?, expiresAt? }. Admin.
giftCardRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { amountMinor?: unknown; currency?: unknown; expiresAt?: unknown };
  try {
    const card = giftCards.issue(Number(body.amountMinor), {
      currency: body.currency === undefined ? undefined : String(body.currency),
      expiresAt: body.expiresAt === undefined || body.expiresAt === null ? null : String(body.expiresAt),
    });
    return res.status(201).json(card);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Check balance (the code is the secret).
giftCardRouter.get('/:code', (req: Request, res: Response) => {
  const card = giftCards.get(req.params.code);
  if (!card) return res.status(404).json({ error: 'card not found' });
  return res.status(200).json({ code: card.code, balanceMinor: card.balanceMinor, currency: card.currency, active: card.active, expiresAt: card.expiresAt });
});

// Redeem against a card. { amountMinor, note? }. 409 on insufficient balance / not redeemable.
giftCardRouter.post('/:code/redeem', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { amountMinor?: unknown; note?: unknown };
  try {
    const card = giftCards.redeem(req.params.code, Number(body.amountMinor), String(body.note ?? ''));
    return res.status(200).json({ code: card.code, balanceMinor: card.balanceMinor, currency: card.currency });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'insufficient balance' || message.includes('not redeemable') ? 409 : 400).json({ error: message });
  }
});

// Enable/disable. { active }. Admin.
giftCardRouter.patch('/:code', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { active?: unknown };
  try {
    const card = giftCards.setActive(req.params.code, Boolean(body.active));
    return res.status(200).json({ code: card.code, active: card.active });
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'card not found' });
  }
});
`;

const GIFTCARDS_README = `# Gift cards / store credit

A real prepaid gift-card / store-credit backend. The core guarantees: a card holds a monetary **balance** in
**integer minor units** (paise/cents), redeeming **debits** the balance atomically and can **never overdraw** (a
redemption for more than the remaining balance is rejected; a partial redemption leaves the **exact** remainder),
and \`sum(redemptions) + balance === original\` always. Codes are unique (\`node:crypto\`); a card can be
deactivated; an expired card can't be redeemed. Files:

- \`giftCardService.ts\` — the domain logic (\`GiftCardService\` + a \`giftCards\` singleton). Uses \`node:crypto\`
  only. In-memory; swap the Map for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { giftCardRouter } from './server/giftcards/routes';
app.use('/api/gift-cards', giftCardRouter);
\`\`\`

Endpoints:
- \`POST  /api/gift-cards\` \`{ amountMinor, currency?, expiresAt? }\` → issue (**admin**).
- \`GET   /api/gift-cards/:code\` → balance check (the code is the secret).
- \`POST  /api/gift-cards/:code/redeem\` \`{ amountMinor, note? }\` → **409** on insufficient balance / not redeemable.
- \`PATCH /api/gift-cards/:code\` \`{ active }\` → enable/disable (**admin**).

Distinct from \`generate_coupons\` (a discount, not a stored balance) and \`generate_loyalty\` (earned points).
Pair with \`generate_orders\` / \`generate_payment\` to apply a card's balance at checkout.
`;

export interface GiftCardsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Gift cards / store credit starter wired under server/giftcards/ (dependency-free domain logic using ' +
  'node:crypto + an Express router). The real guarantee is BALANCE INTEGRITY: issue(amountMinor) makes a card ' +
  'with a UNIQUE code and a balance in INTEGER minor units; redeem(code, amount) DEBITS atomically and can ' +
  'NEVER overdraw (amount > balance → "insufficient balance"; a partial redemption leaves the EXACT remainder; ' +
  'sum(redemptions)+balance === original always); an inactive/expired card is not redeemable; balance(code) ' +
  'checks. routes.ts exposes POST /api/gift-cards ({amountMinor,currency?,expiresAt?}, admin), GET ' +
  '/api/gift-cards/:code (balance), POST /api/gift-cards/:code/redeem ({amountMinor,note?} — 409 on ' +
  'insufficient/not-redeemable) and PATCH /api/gift-cards/:code ({active}). Mount at app.use("/api/gift-cards", ' +
  'giftCardRouter); guard the issue/disable routes with admin auth. Distinct from generate_coupons (a discount) ' +
  'and generate_loyalty (earned points); pairs with generate_orders/generate_payment. In-memory by default — ' +
  'swap the Map for your DB.';

export function generateGiftCardsIntegration(): GiftCardsConfig {
  return {
    files: {
      'server/giftcards/giftCardService.ts': GIFTCARDS_SERVICE_SOURCE,
      'server/giftcards/routes.ts': GIFTCARDS_ROUTES_SOURCE,
      'server/giftcards/README.md': GIFTCARDS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
