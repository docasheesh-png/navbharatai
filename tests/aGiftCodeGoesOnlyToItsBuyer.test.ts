// Q-630 (forensic audit 2026-10-04) — a gift code is money in the hand of whoever reads it.
//
// `POST /api/payment/verify-payment` needs no sign-in: an order id is enough to ask whether it was paid.
// On the call that fulfilled a GIFT order it answered with the gift code itself, and the order id travels
// in the payment redirect URL. So anyone who saw that URL (a shared screen, a proxy log, browser history on
// a shared device) could redeem the code before the buyer. Now the code goes only to the buyer's own
// verified token; anyone else still learns the order succeeded.

import { describe, it, expect, vi } from 'vitest';

// "Bearer <uid>" is that signed-in account; no header is nobody.
vi.mock('../src/server/lib/authMiddleware', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/authMiddleware')>()),
  verifyFirebaseToken: vi.fn(async (req: { headers?: Record<string, string> }) => {
    const h = req.headers?.authorization ?? '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
  }),
}));

// The order the route settles: a fulfilled gift bought by `buyer-1`.
vi.mock('../src/server/lib/payments', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/payments')>()),
  verifyPaymentInternal: vi.fn(async () => ({
    success: true,
    data: { giftCode: 'NBGIFT-ABCD-EFGH', giftFaceInr: 500, paidInr: 500, buyerUid: 'buyer-1' },
  })),
}));

import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

async function verifyPayment(headers: Record<string, string>) {
  const { registerPaymentRoutes } = await import('../src/server/routes/payment');
  const handler = captureRoutes(registerPaymentRoutes, () => {}).get('POST /api/payment/verify-payment')!;
  const res = mockRes();
  await handler(mockReq({ body: { orderId: 'order_123' }, headers }), res);
  return res;
}

describe('verify-payment hands a gift code only to its buyer', () => {
  it('the buyer, signed in, receives the code', async () => {
    const res = await verifyPayment({ authorization: 'Bearer buyer-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.giftCode).toBe('NBGIFT-ABCD-EFGH');
    expect(res.body.giftFaceInr).toBe(500);
  });

  it('a caller holding only the order id learns it succeeded, not the code', async () => {
    const res = await verifyPayment({});
    expect(res.statusCode).toBe(200);
    expect(res.body.giftCode).toBeUndefined();
    expect(res.body.giftFaceInr).toBeUndefined();
    expect(res.body.giftCodeDelivered).toBe('to-buyer-only');
  });

  it('another signed-in account does not receive it either', async () => {
    const res = await verifyPayment({ authorization: 'Bearer someone-else' });
    expect(res.body.giftCode).toBeUndefined();
  });

  it('the buyer\'s uid is never part of the answer', async () => {
    for (const headers of [{}, { authorization: 'Bearer buyer-1' }]) {
      const res = await verifyPayment(headers);
      expect(res.body.buyerUid).toBeUndefined();
    }
  });
});
