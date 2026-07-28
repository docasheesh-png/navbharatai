/**
 * Route handler validation tests — Payment and Preview routes.
 *
 * Tests early-return 400 branches that fire before any Firestore or AI call.
 * No server boot required; uses captureRoutes() + direct handler invocation.
 */
import { describe, it, expect } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

// ── Payment routes ────────────────────────────────────────────────────────────

async function importPaymentRoutes() {
  const { registerPaymentRoutes } = await import('../src/server/routes/payment');
  return registerPaymentRoutes;
}

describe('Payment routes — /api/payment/create-order', () => {
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

  it('refuses an underpaid Professional Pass order before it reaches the gateway', async () => {
    // The ₹1-for-a-hundred-years order: the fulfilment path now derives the entitlement from the paid
    // amount, so an underpaid order would take the customer's money and grant nothing. It is refused
    // here instead, with the real price stated.
    const register = await importPaymentRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/payment/create-order')!;

    const req = mockReq({ body: { userId: 'user123', amount: 1, productType: 'professional_pass', passDays: 36500 } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('pass_amount_too_low');
    expect(res.body?.passPriceInr).toBe(99);
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
  it('returns 400 when files is missing', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/preview')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/files.*required/i);
  });

  it('returns 400 when files object is empty', async () => {
    const register = await importPreviewRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/preview')!;

    const req = mockReq({ body: { files: {} } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/no files provided/i);
  });
});
