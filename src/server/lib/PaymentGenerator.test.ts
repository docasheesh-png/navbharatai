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
    expect(c.envKeys).toEqual(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']);
    expect(c.dependency).toEqual({ name: 'razorpay', version: '^2' });
    expect(c.files['.env.example']).toContain('RAZORPAY_KEY_ID=\n');
    expect(c.files['.env.example']).toContain('RAZORPAY_KEY_SECRET=\n');
    expect(c.instructions).toContain('YOUR Razorpay account');
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

  it('isPaymentProvider accepts the three providers and rejects anything else; unknown → throws', () => {
    expect(isPaymentProvider('cashfree')).toBe(true);
    expect(isPaymentProvider('razorpay')).toBe(true);
    expect(isPaymentProvider('stripe')).toBe(true);
    for (const v of ['paypal', '', null, 7]) expect(isPaymentProvider(v)).toBe(false);
    // @ts-expect-error invalid provider
    expect(() => generatePaymentIntegration('paypal')).toThrow();
  });
});

// ROADMAP §13, 3.2 — Cashfree (UPI first) + verified webhooks on both Indian recipes.
describe('generatePaymentIntegration — Cashfree (ROADMAP §13, 3.2)', () => {
  const c = generatePaymentIntegration('cashfree');
  const server = c.files['server/routes/payment.ts'];

  it('creates the order against the REAL Cashfree PG API and hands the client a payment session id', () => {
    expect(server).toContain("'https://api.cashfree.com/pg'");
    expect(server).toContain("'https://sandbox.cashfree.com/pg'");
    expect(server).toContain("'x-client-id'");
    expect(server).toContain("'x-client-secret'");
    expect(server).toContain("'x-api-version': '2023-08-01'");
    expect(server).toContain("paymentRouter.post('/order'");
    expect(server).toContain('payment_session_id');
    expect(server).toContain("order_currency: 'INR'");
  });

  it('🔒 verifies by asking CASHFREE whether the order is PAID — never the browser', () => {
    expect(server).toContain("paymentRouter.post('/verify'");
    expect(server).toContain("CF_BASE + '/orders/' + encodeURIComponent(orderId)");
    expect(server).toContain("data.order_status === 'PAID'");
  });

  it('🔒 the webhook checks Cashfree\'s documented signature — base64 HMAC-SHA256(timestamp + rawBody, client secret) — in constant time', () => {
    expect(server).toContain('export function paymentWebhook');
    expect(server).toContain("req.header('x-webhook-timestamp')");
    expect(server).toContain("req.header('x-webhook-signature')");
    expect(server).toContain("createHmac('sha256', secret).update(ts + raw.toString('utf8')).digest('base64')");
    expect(server).toContain('crypto.timingSafeEqual(a, b)');
    expect(server).toContain("'PAYMENT_SUCCESS_WEBHOOK'");
  });

  it('client helper opens the Cashfree SDK checkout (UPI/cards/net banking) and verifies on the server', () => {
    const client = c.files['src/lib/cashfree.ts'];
    expect(client).toContain('export async function payWithCashfree');
    expect(client).toContain('https://sdk.cashfree.com/js/v3/cashfree.js');
    expect(client).toContain("redirectTarget: '_modal'");
    expect(client).toContain('/api/payment/verify');
  });

  it('is dependency-free, declares the three env keys blank, and the instructions say UPI, the webhook screen and whose account the money lands in', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV']);
    for (const k of c.envKeys) expect(c.files['.env.example']).toContain(`${k}=\n`);
    expect(c.instructions).toContain('UPI');
    expect(c.instructions).toContain('Developers → Webhooks');
    expect(c.instructions).toContain('YOUR Cashfree account');
    expect(c.instructions).toContain('Secrets & API Keys');
  });

  it('isPaymentProvider accepts cashfree', () => {
    expect(isPaymentProvider('cashfree')).toBe(true);
  });
});

describe('Razorpay — the webhook that survives a closed tab', () => {
  const c = generatePaymentIntegration('razorpay');
  const server = c.files['server/routes/payment.ts'];

  it('🔒 verifies X-Razorpay-Signature = hex HMAC-SHA256(rawBody, webhook secret) in constant time', () => {
    expect(server).toContain('export function paymentWebhook');
    expect(server).toContain("req.header('x-razorpay-signature')");
    expect(server).toContain("createHmac('sha256', secret).update(raw).digest('hex')");
    expect(server).toContain('crypto.timingSafeEqual(a, b)');
    expect(server).toContain("'payment.captured'");
    expect(c.envKeys).toContain('RAZORPAY_WEBHOOK_SECRET');
    expect(c.files['.env.example']).toContain('RAZORPAY_WEBHOOK_SECRET=\n');
  });

  it('the instructions name UPI and whose account the money lands in', () => {
    expect(c.instructions).toContain('UPI');
    expect(c.instructions).toContain('YOUR Razorpay account');
  });
});

describe('🔒 white-label + real-features, every provider', () => {
  it('no AI vendor appears in generated payment code; no TODO stubs in the Cashfree recipe', () => {
    for (const p of ['cashfree', 'razorpay', 'stripe'] as const) {
      const cfg = generatePaymentIntegration(p);
      const all = Object.values(cfg.files).join('\n') + cfg.instructions;
      expect(all).not.toMatch(/claude|anthropic|gemini|openai|glm|kimi|grok/i);
      expect(cfg.files['server/routes/payment.ts']).not.toMatch(/TODO|FIXME|your-code-here|not implemented/i);
    }
  });
});
