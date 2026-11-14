/**
 * Route handler validation tests — Payment and Preview routes.
 *
 * Tests early-return validation after an acknowledged unlocked-account read, before payment writes or AI calls.
 * No server boot required; uses captureRoutes() + direct handler invocation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A request with a Bearer header is a signed-in caller; without one it is not. Everything else in the
// module is real. (POST /api/preview requires an account since the forensic audit of 2026-10-04.)
vi.mock('../src/server/lib/authMiddleware', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/authMiddleware')>()),
  verifyFirebaseToken: vi.fn(async (req: { headers?: Record<string, string> }) =>
    (req.headers?.authorization ?? '').startsWith('Bearer ') ? 'u1' : null),
}));
// A reachable store with an acknowledged missing lock document is an unlocked account.
// Database absence is a different security condition, tested explicitly below.
const lockStore = vi.hoisted(() => ({ available: true, reads: 0 }));
vi.mock('../src/server/lib/serverDb', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/serverDb')>()),
  getServerDb: () => lockStore.available ? {
    doc: (path: string) => {
      if (!path.startsWith('user_vault_pin/')) throw Error('Unexpected database access in validation fixture');
      return { get: async () => { lockStore.reads += 1; return { exists: false, data: () => undefined, id: path.split('/')[1], get: () => undefined }; } };
    },
  } : null,
}));
beforeEach(() => { lockStore.available = true; lockStore.reads = 0; });
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

// ── Payment routes ────────────────────────────────────────────────────────────

async function importPaymentRoutes() {
  const { registerPaymentRoutes } = await import('../src/server/routes/payment');
  return registerPaymentRoutes;
}

describe('Payment routes — /api/payment/create-order', () => {
  it('refuses an unavailable lock database before validating an otherwise invalid amount', async () => {
    lockStore.available = false;
    const routes = captureRoutes(await importPaymentRoutes(), () => {});
    const res = mockRes();
    await routes.get('POST /api/payment/create-order')!(mockReq({ body: { userId: 'user123', amount: 'abc' } }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body?.error).toMatch(/could not check your app lock/i);
    expect(res.body?.paymentSessionId).toBeUndefined();
    expect(lockStore.reads).toBe(0);
  });
  it('registers payment endpoints', async () => {
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    expect(routes.has('POST /api/payment/create-order')).toBe(true);
    expect(routes.has('POST /api/payment/verify-payment')).toBe(true);
    expect(routes.has('POST /api/payment/redeem-coupon')).toBe(true);
  });

  it('returns 401 when the caller is not authenticated', async () => {
    // SECURITY (money, 2026-07-27): this route used to take `userId` straight from the request body,
    // so anyone could create a payment order against any account and every entitlement downstream was
    // keyed on a value the caller chose. The owner now comes from the verified token — with no
    // identity at all the order must be refused before anything is written.
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/payment/create-order')!;

    const req = mockReq({ body: { amount: 100 } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toMatch(/sign in/i);
  });

  /**
   * SUPERSEDED 2026-08-10 — this used to assert that an UNDERPAID pass order was refused (the
   * ₹1-for-a-hundred-years order). The admin withdrew the Pass entirely ("pass system hata do"), so
   * the stronger contract now holds: NO pass order is accepted at any price. The intent the old test
   * protected — a pass order must never reach the gateway and take a customer's money — is kept and
   * widened, which is why the case is rewritten here rather than deleted.
   */
  it('refuses a Professional Pass order at ANY amount — the product is withdrawn', async () => {
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/payment/create-order')!;

    // The old exploit amount, and the full price: both refused now.
    for (const amount of [1, 99, 500]) {
      const req = mockReq({ body: { userId: 'user123', amount, productType: 'professional_pass', passDays: 36500 } });
      const res = mockRes();
      await handler(req, res);
      expect(res.statusCode).toBe(410); // Gone — the product existed and no longer does
      expect(res.body?.code).toBe('pass_withdrawn');
      // Money arriving for a withdrawn product is the worst outcome; nothing may reach the gateway.
      expect(res.body?.paymentSessionId).toBeUndefined();
      // And the user is pointed at the thing that actually works.
      expect(String(res.body?.error)).toMatch(/add credit/i);
    }
  });

  it('returns 400 when order amount is invalid (NaN)', async () => {
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/payment/create-order')!;

    const req = mockReq({ body: { userId: 'user123', amount: 'abc' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/invalid order amount/i);
    expect(lockStore.reads).toBe(1);
  });

  it('returns 400 when order amount is zero or negative', async () => {
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/payment/create-order')!;

    const req = mockReq({ body: { userId: 'user123', amount: -50 } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/invalid order amount/i);
    expect(lockStore.reads).toBe(1);
  });
});

describe('Payment routes — /api/payment/verify-payment', () => {
  it('returns 400 when orderId is missing', async () => {
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/payment/verify-payment')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/order id is required/i);
  });
});

describe('Payment routes — /api/payment/redeem-coupon', () => {
  it('returns 401 when the caller is not authenticated (no verified uid)', async () => {
    // SECURITY (H1): the route now derives identity from the verified Firebase token, not the
    // body. Under VITEST it accepts a body userId; with none present the caller is unauthenticated
    // and must be rejected with 401 (before the coupon-code check).
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/payment/redeem-coupon')!;

    const req = mockReq({ body: { code: 'PROMO10' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toMatch(/sign in again/i);
  });

  it('returns 400 when coupon code is missing', async () => {
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/payment/redeem-coupon')!;

    const req = mockReq({ body: { userId: 'user123' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/promo coupon code is required/i);
  });
});

// ── Preview routes ────────────────────────────────────────────────────────────

async function importPreviewRoutes() {
  const { registerPreviewRoutes } = await import('../src/server/routes/preview');
  return registerPreviewRoutes;
}

describe('Preview routes — /api/preview-bundle', () => {
  it('registers preview endpoints', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('POST /api/preview-bundle')).toBe(true);
    expect(routes.has('POST /api/preview-vue')).toBe(true);
    expect(routes.has('POST /api/preview')).toBe(true);
  });

  it('returns 400 when files is missing', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/preview-bundle')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/files required/i);
  });

  it('returns 400 when files is a string (not an object)', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/preview-bundle')!;

    const req = mockReq({ body: { files: '<h1>Hello</h1>' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/files required/i);
  });
});

describe('Preview routes — /api/preview-vue', () => {
  it('returns 400 when files is missing', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/preview-vue')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/files required/i);
  });
});

describe('Preview routes — /api/preview', () => {
  it('returns 401 for a caller with no account', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/preview')!;

    const res = mockRes();
    await handler(mockReq({ body: { files: { 'index.html': '<h1>x</h1>' } } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when files is missing', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/preview')!;

    const req = mockReq({ body: {}, headers: { authorization: 'Bearer t' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/files.*required/i);
  });

  it('returns 400 when files object is empty', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/preview')!;

    const req = mockReq({ body: { files: {} }, headers: { authorization: 'Bearer t' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/no files provided/i);
  });
});
