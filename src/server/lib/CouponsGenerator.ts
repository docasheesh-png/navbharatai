// Roadmap breadth — coupons / discount-codes starter (a packaged domain vertical).
//
// A high-value vertical for ecommerce, SaaS and any checkout. The real feature is REDEMPTION INTEGRITY: a code
// enforces an optional TOTAL-redemption cap and an optional PER-USER limit (both counted exactly), respects an
// expiry window and an active flag and a minimum order amount, and computes the discount correctly (percentage
// — capped so it never exceeds the order total — or a fixed amount, never below zero). This emits a
// dependency-free CouponService + an Express router + a README. Real logic, not a stub — the caps + discount
// math are unit-tested against the emitted code. Pure builder → the caller writes the files.

export const COUPON_SERVICE_SOURCE = `// Coupons / discount-codes domain logic. The core guarantees: (1) a code's TOTAL redemptions and PER-USER
// redemptions never exceed their configured caps, (2) an expired / inactive code or an order below the minimum
// is rejected, and (3) the discount is computed correctly — percentage (capped at the order total) or fixed
// (never below zero). In-memory here; swap the Maps for your database, keeping the same method contracts.

export type DiscountType = 'percent' | 'fixed';

export interface Coupon {
  code: string;                 // normalized upper-case
  type: DiscountType;
  value: number;                // percent (0..100) or fixed amount in the smallest currency unit (e.g. paise/cents)
  active: boolean;
  minOrder: number;             // minimum order amount to qualify (0 = no minimum)
  maxRedemptions: number | null;   // total redemptions allowed across all users (null = unlimited)
  perUserLimit: number | null;     // redemptions allowed per user (null = unlimited)
  expiresAt: string | null;        // ISO; null = never expires
  createdAt: string;
}

export interface Redemption {
  code: string;
  user: string;
  orderAmount: number;
  discount: number;
  at: string;
}

export class CouponService {
  private coupons = new Map<string, Coupon>();
  private redemptions: Redemption[] = [];

  private norm(code: string): string {
    return String(code ?? '').trim().toUpperCase();
  }

  /** Create/replace a coupon. value: 1..100 for 'percent', a positive amount for 'fixed'. */
  create(input: {
    code: string; type: DiscountType; value: number; active?: boolean; minOrder?: number;
    maxRedemptions?: number | null; perUserLimit?: number | null; expiresAt?: string | null;
  }, now: Date = new Date()): Coupon {
    const code = this.norm(input?.code);
    if (!code) throw new Error('code is required');
    if (input?.type !== 'percent' && input?.type !== 'fixed') throw new Error("type must be 'percent' or 'fixed'");
    const value = Number(input.value);
    if (!Number.isFinite(value) || value <= 0) throw new Error('value must be a positive number');
    if (input.type === 'percent' && value > 100) throw new Error('percent value cannot exceed 100');
    const coupon: Coupon = {
      code,
      type: input.type,
      value,
      active: input.active !== false,
      minOrder: Math.max(0, Number(input.minOrder) || 0),
      maxRedemptions: input.maxRedemptions == null ? null : Math.max(0, Math.floor(Number(input.maxRedemptions))),
      perUserLimit: input.perUserLimit == null ? null : Math.max(0, Math.floor(Number(input.perUserLimit))),
      expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
      createdAt: now.toISOString(),
    };
    this.coupons.set(code, coupon);
    return coupon;
  }

  get(code: string): Coupon | undefined {
    return this.coupons.get(this.norm(code));
  }

  private totalRedemptions(code: string): number {
    return this.redemptions.filter((r) => r.code === code).length;
  }

  private userRedemptions(code: string, user: string): number {
    return this.redemptions.filter((r) => r.code === code && r.user === user).length;
  }

  /** Compute the discount a coupon would give on an order (does NOT redeem). Capped at the order total. */
  private discountFor(coupon: Coupon, orderAmount: number): number {
    if (coupon.type === 'percent') {
      return Math.min(orderAmount, Math.floor((orderAmount * coupon.value) / 100));
    }
    return Math.min(orderAmount, coupon.value);
  }

  /**
   * Validate a coupon for a user + order WITHOUT redeeming. Returns { ok:true, discount } or { ok:false, reason }.
   * Checks: exists, active, not expired, order >= minOrder, total cap, per-user cap.
   */
  validate(code: string, user: string, orderAmount: number, now: Date = new Date()): { ok: boolean; discount?: number; reason?: string } {
    const c = this.coupons.get(this.norm(code));
    const who = String(user).trim();
    const amount = Number(orderAmount);
    if (!c) return { ok: false, reason: 'unknown coupon' };
    if (!who) return { ok: false, reason: 'user is required' };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalid order amount' };
    if (!c.active) return { ok: false, reason: 'coupon is not active' };
    if (c.expiresAt && new Date(c.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: 'coupon expired' };
    if (amount < c.minOrder) return { ok: false, reason: 'order below the minimum for this coupon' };
    if (c.maxRedemptions != null && this.totalRedemptions(c.code) >= c.maxRedemptions) return { ok: false, reason: 'coupon redemption limit reached' };
    if (c.perUserLimit != null && this.userRedemptions(c.code, who) >= c.perUserLimit) return { ok: false, reason: 'per-user redemption limit reached' };
    return { ok: true, discount: this.discountFor(c, amount) };
  }

  /**
   * Redeem a coupon: validate, then record the redemption (which counts toward both caps). Returns the
   * Redemption on success. Throws with the validation reason on failure.
   */
  redeem(code: string, user: string, orderAmount: number, now: Date = new Date()): Redemption {
    const check = this.validate(code, user, orderAmount, now);
    if (!check.ok) throw new Error(check.reason);
    const redemption: Redemption = {
      code: this.norm(code),
      user: String(user).trim(),
      orderAmount: Number(orderAmount),
      discount: check.discount as number,
      at: now.toISOString(),
    };
    this.redemptions.push(redemption);
    return redemption;
  }

  /** Usage stats for a coupon. */
  stats(code: string): { code: string; total: number; remaining: number | null } {
    const c = this.coupons.get(this.norm(code));
    if (!c) throw new Error('unknown coupon');
    const total = this.totalRedemptions(c.code);
    return { code: c.code, total, remaining: c.maxRedemptions == null ? null : Math.max(0, c.maxRedemptions - total) };
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const coupons = new CouponService();
`;

export const COUPON_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { coupons } from './couponService';

// REST endpoints for the coupon service. Mount with: app.use('/api', couponRouter).
export const couponRouter = Router();

// Create a coupon. { code, type, value, active?, minOrder?, maxRedemptions?, perUserLimit?, expiresAt? }.
couponRouter.post('/coupons', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    return res.status(201).json(coupons.create({
      code: String(body.code ?? ''), type: body.type as 'percent', value: Number(body.value),
      active: body.active === undefined ? undefined : Boolean(body.active),
      minOrder: body.minOrder === undefined ? undefined : Number(body.minOrder),
      maxRedemptions: body.maxRedemptions === undefined ? undefined : (body.maxRedemptions === null ? null : Number(body.maxRedemptions)),
      perUserLimit: body.perUserLimit === undefined ? undefined : (body.perUserLimit === null ? null : Number(body.perUserLimit)),
      expiresAt: body.expiresAt === undefined || body.expiresAt === null ? null : String(body.expiresAt),
    }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Validate a coupon (does NOT redeem). { code, user, orderAmount } → { ok, discount } | { ok:false, reason }.
couponRouter.post('/coupons/validate', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { code?: unknown; user?: unknown; orderAmount?: unknown };
  const result = coupons.validate(String(body.code ?? ''), String(body.user ?? ''), Number(body.orderAmount));
  return res.status(result.ok ? 200 : 422).json(result);
});

// Redeem a coupon. { code, user, orderAmount } — 422 if it cannot be redeemed.
couponRouter.post('/coupons/redeem', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { code?: unknown; user?: unknown; orderAmount?: unknown };
  try {
    return res.status(201).json(coupons.redeem(String(body.code ?? ''), String(body.user ?? ''), Number(body.orderAmount)));
  } catch (err) {
    return res.status(422).json({ error: err instanceof Error ? err.message : 'could not redeem' });
  }
});

// Coupon usage stats.
couponRouter.get('/coupons/:code/stats', (req: Request, res: Response) => {
  try {
    return res.status(200).json(coupons.stats(req.params.code));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'unknown coupon' });
  }
});
`;

const COUPON_README = `# Coupons / discount codes

A real coupon backend. The core guarantees: a code's **total** and **per-user** redemptions never exceed their
caps, an **expired / inactive** code or an order **below the minimum** is rejected, and the discount is computed
correctly — **percentage** (capped at the order total) or **fixed** (never below zero). Files:

- \`couponService.ts\` — the domain logic (\`CouponService\` + a \`coupons\` singleton). In-memory; swap the Maps for
  your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { couponRouter } from './server/coupons/routes';
app.use('/api', couponRouter);
\`\`\`

Endpoints:
- \`POST /api/coupons\` \`{ code, type: 'percent'|'fixed', value, active?, minOrder?, maxRedemptions?, perUserLimit?, expiresAt? }\`.
- \`POST /api/coupons/validate\` \`{ code, user, orderAmount }\` → \`{ ok, discount }\` or \`{ ok:false, reason }\` (**422**). Use at cart display.
- \`POST /api/coupons/redeem\` \`{ code, user, orderAmount }\` → records the redemption (**422** if it cannot be redeemed). Call at checkout.
- \`GET  /api/coupons/:code/stats\` → \`{ total, remaining }\`.

Amounts are in the smallest currency unit (paise/cents). \`validate\` is safe to call repeatedly; \`redeem\` is the
one that counts toward the caps — call it exactly once per successful order.
`;

export interface CouponsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Coupons / discount-codes starter wired under server/coupons/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is REDEMPTION INTEGRITY: validate()/redeem() enforce an optional total-redemption ' +
  'cap AND an optional per-user limit (both counted exactly), reject an expired/inactive code or an order below ' +
  'minOrder, and compute the discount correctly — percent (capped at the order total) or fixed (never below 0). ' +
  'validate() checks WITHOUT counting; redeem() records the redemption (counts toward both caps). routes.ts ' +
  'exposes POST /coupons, POST /coupons/validate (422 with a reason if not usable), POST /coupons/redeem (422 on ' +
  'failure) and GET /coupons/:code/stats. Mount with app.use("/api", couponRouter). Amounts are in the smallest ' +
  'currency unit (paise/cents). Call redeem() exactly once per successful order. In-memory by default — swap the ' +
  'Maps for your DB. Pairs with generate_payment / generate_loyalty / generate_listings.';

export function generateCouponsIntegration(): CouponsConfig {
  return {
    files: {
      'server/coupons/couponService.ts': COUPON_SERVICE_SOURCE,
      'server/coupons/routes.ts': COUPON_ROUTES_SOURCE,
      'server/coupons/README.md': COUPON_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
