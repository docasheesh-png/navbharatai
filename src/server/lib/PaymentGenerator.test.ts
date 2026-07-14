import { describe, it, expect } from 'vitest';
import { generatePaymentIntegration, isPaymentProvider } from './PaymentGenerator';

describe('generatePaymentIntegration — Razorpay', () => {
  const c = generatePaymentIntegration('razorpay');

  it('emits a server route that creates an order AND verifies the signature (never trust the client)', () => {
    const server = c.files['server/routes/payment.ts'];
    expect(server).toContain("import Razorpay from 'razorpay'");
    expect(server).toContain("paymentRouter.post('/order'");
    expect(server).toContain("paymentRouter.post('/verify'");
    expect(server).toContain("createHmac('sha256'"); // real signature verification
    expect(server).toContain('RAZORPAY_KEY_SECRET');
  });

  it('emits a client helper that opens Checkout and verifies on the server', () => {
    const client = c.files['src/lib/razorpay.ts'];
    expect(client).toContain('export async function payWithRazorpay');
    expect(client).toContain('checkout.razorpay.com/v1/checkout.js');
    expect(client).toContain("/api/payment/verify");
  });

  it('declares env keys + dependency + honest instructions, with blank .env.example values', () => {
    expect(c.envKeys).toEqual(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']);
    expect(c.dependency).toEqual({ name: 'razorpay', version: '^2' });
    expect(c.files['.env.example']).toContain('RAZORPAY_KEY_ID=\n');
    expect(c.files['.env.example']).toContain('RAZORPAY_KEY_SECRET=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('generatePaymentIntegration — Stripe', () => {
  const c = generatePaymentIntegration('stripe');

  it('emits a server checkout-session route and a client redirect helper', () => {
    expect(c.files['server/routes/payment.ts']).toContain('stripe.checkout.sessions.create');
    expect(c.files['server/routes/payment.ts']).toContain("paymentRouter.post('/checkout'");
    expect(c.files['src/lib/stripe.ts']).toContain('export async function payWithStripe');
    expect(c.files['src/lib/stripe.ts']).toContain('window.location.href = url');
    expect(c.envKeys).toEqual(['STRIPE_SECRET_KEY']);
    expect(c.dependency.name).toBe('stripe');
  });
});

describe('safety + guards', () => {
  it('every provider blanks its secret values in .env.example (never a baked-in key)', () => {
    for (const p of ['razorpay', 'stripe'] as const) {
      const cfg = generatePaymentIntegration(p);
      for (const k of cfg.envKeys) expect(cfg.files['.env.example']).toContain(`${k}=\n`);
    }
  });

  it('the generated server code has no TODO/stub placeholders (real-features rule)', () => {
    for (const p of ['razorpay', 'stripe'] as const) {
      const server = generatePaymentIntegration(p).files['server/routes/payment.ts'];
      expect(server).not.toMatch(/TODO|FIXME|your-code-here|not implemented/i);
    }
  });

  it('isPaymentProvider accepts the two providers and rejects anything else; unknown → throws', () => {
    expect(isPaymentProvider('razorpay')).toBe(true);
    expect(isPaymentProvider('stripe')).toBe(true);
    for (const v of ['paypal', '', null, 7]) expect(isPaymentProvider(v)).toBe(false);
    // @ts-expect-error invalid provider
    expect(() => generatePaymentIntegration('paypal')).toThrow();
  });
});
