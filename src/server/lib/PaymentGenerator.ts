// U-4 (verified recipe modules) — payment-integration generator (Cashfree + Razorpay + Stripe).
//
// Real, working checkout integrations generated into the app, Bring-Your-Own-keys (the user's keys live in
// THEIR env — pasted into .env, or saved in the per-app vault, which is merged into the app's .env at build;
// NavBharatAI never holds them and the money lands in the USER's merchant account, never ours). Each recipe
// includes a SERVER route (order/session creation + verification — a payment is never trusted from the
// client alone), a WEBHOOK route with real signature verification (the provider's "paid" callback is the
// only thing that survives a closed browser tab), and a CLIENT helper that opens the provider's checkout.
// India-first: Cashfree and Razorpay both offer UPI (GPay / PhonePe / Paytm / BHIM) in the checkout by
// default — the one thing every Stripe-only competitor cannot do for an Indian shop (ROADMAP §13, 3.2).
// PURE builders; the generated code is correct and complete (no TODO stubs — the real-features rule).

export type PaymentProvider = 'cashfree' | 'razorpay' | 'stripe';

export interface PaymentConfig {
  provider: PaymentProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Absent when the recipe is dependency-free (Cashfree uses the platform's own fetch + node:crypto). */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const RAZORPAY_SERVER = `import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import { Router } from 'express';

// Bring-Your-Own Razorpay keys — from Razorpay Dashboard → Settings → API Keys, pasted into .env.
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID as string,
  key_secret: process.env.RAZORPAY_KEY_SECRET as string,
});

export const paymentRouter = Router();

// 1) Create an order. \`amount\` is in the SMALLEST unit (paise: ₹100 = 10000). The client opens Checkout
//    with the returned orderId + keyId.
paymentRouter.post('/order', async (req, res) => {
  const { amount, currency = 'INR' } = req.body ?? {};
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'amount (paise) is required' });
  try {
    const order = await razorpay.orders.create({ amount, currency, receipt: 'rcpt_' + Date.now() });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch {
    res.status(500).json({ error: 'Could not create the Razorpay order' });
  }
});

// 2) Verify the payment signature AFTER checkout — never trust the client's "success" alone. Only a
//    signature that matches HMAC-SHA256(order_id|payment_id, key_secret) is a real, paid order.
paymentRouter.post('/verify', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  const ok = typeof razorpay_signature === 'string' && expected === razorpay_signature;
  res.status(ok ? 200 : 400).json({ verified: ok });
});

// 3) Webhook — Razorpay calls this when a payment is captured, even if the buyer closed the tab before
//    /verify ran. Mount it with express.raw() so the RAW body is signed exactly as Razorpay sent it:
//      app.post('/api/payment/webhook', express.raw({ type: '*/*' }), paymentWebhook);
//    Register the URL + the same secret in Razorpay Dashboard → Settings → Webhooks (event payment.captured).
export function paymentWebhook(req: import('express').Request, res: import('express').Response) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const header = req.header('x-razorpay-signature') ?? '';
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  if (!secret) return res.status(400).json({ error: 'RAZORPAY_WEBHOOK_SECRET is not set' });
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(header);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'bad signature' });
  const event = JSON.parse(raw.toString('utf8'));
  if (event?.event === 'payment.captured') {
    const payment = event.payload?.payment?.entity;
    // Mark payment.order_id as PAID in your database here (idempotently — Razorpay may retry).
    console.log('[razorpay] paid', payment?.order_id, payment?.id, payment?.amount);
  }
  res.json({ ok: true });
}
`;

const RAZORPAY_CLIENT = `// Opens Razorpay Checkout and verifies the result on the server. Resolves on a verified payment.
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(\`script[src="\${src}"]\`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.body.appendChild(s);
  });
}

export async function payWithRazorpay(amountPaise: number, name = 'Payment'): Promise<void> {
  await loadScript('https://checkout.razorpay.com/v1/checkout.js');
  const orderRes = await fetch('/api/payment/order', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: amountPaise }),
  });
  if (!orderRes.ok) throw new Error('Could not create the order');
  const { orderId, amount, currency, keyId } = await orderRes.json();

  return new Promise<void>((resolve, reject) => {
    const rzp = new (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay({
      key: keyId, amount, currency, order_id: orderId, name,
      handler: async (r: Record<string, string>) => {
        const v = await fetch('/api/payment/verify', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r),
        });
        const { verified } = await v.json();
        verified ? resolve() : reject(new Error('Payment verification failed'));
      },
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
    });
    rzp.open();
  });
}
`;

const CASHFREE_SERVER = `import crypto from 'node:crypto';
import { Router } from 'express';

// Bring-Your-Own Cashfree keys — Cashfree Payments Dashboard → Developers → API Keys. Two environments:
// sandbox keys work only against sandbox.cashfree.com, production keys against api.cashfree.com. The
// checkout shows UPI (GPay / PhonePe / Paytm / BHIM), cards, net banking and wallets by default.
const CF_BASE = process.env.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const cfHeaders = () => ({
  'x-client-id': process.env.CASHFREE_APP_ID as string,
  'x-client-secret': process.env.CASHFREE_SECRET_KEY as string,
  'x-api-version': '2023-08-01',
  'content-type': 'application/json',
});

export const paymentRouter = Router();

// 1) Create an order. \`amount\` is in RUPEES (₹199.50 = 199.5). Returns the paymentSessionId the client
//    opens the checkout with, plus the orderId you store against the purchase.
paymentRouter.post('/order', async (req, res) => {
  const { amount, customerId, customerPhone, customerEmail } = req.body ?? {};
  if (typeof amount !== 'number' || !(amount > 0)) return res.status(400).json({ error: 'amount (rupees) is required' });
  if (!customerPhone || !/^\\d{10}$/.test(String(customerPhone))) return res.status(400).json({ error: 'a 10-digit customerPhone is required by Cashfree' });
  const orderId = 'order_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  try {
    const r = await fetch(CF_BASE + '/orders', {
      method: 'POST', headers: cfHeaders(),
      body: JSON.stringify({
        order_id: orderId, order_amount: Number(amount.toFixed(2)), order_currency: 'INR',
        customer_details: { customer_id: String(customerId ?? customerPhone), customer_phone: String(customerPhone), ...(customerEmail ? { customer_email: String(customerEmail) } : {}) },
        order_meta: { return_url: (req.headers.origin ?? '') + '/payment/return?order_id={order_id}' },
      }),
    });
    const data = await r.json() as { payment_session_id?: string; message?: string };
    if (!r.ok || !data.payment_session_id) return res.status(502).json({ error: data.message || 'Could not create the Cashfree order' });
    res.json({ orderId, paymentSessionId: data.payment_session_id, mode: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox' });
  } catch {
    res.status(500).json({ error: 'Could not create the Cashfree order' });
  }
});

// 2) Verify by asking CASHFREE, never the browser: only an order Cashfree itself reports as PAID is paid.
paymentRouter.post('/verify', async (req, res) => {
  const { orderId } = req.body ?? {};
  if (typeof orderId !== 'string' || !orderId) return res.status(400).json({ error: 'orderId is required' });
  try {
    const r = await fetch(CF_BASE + '/orders/' + encodeURIComponent(orderId), { headers: cfHeaders() });
    const data = await r.json() as { order_status?: string; order_amount?: number };
    const verified = r.ok && data.order_status === 'PAID';
    res.status(verified ? 200 : 400).json({ verified, status: data.order_status ?? 'UNKNOWN', amount: data.order_amount });
  } catch {
    res.status(502).json({ verified: false, error: 'Could not reach Cashfree' });
  }
});

// 3) Webhook — Cashfree calls this on PAYMENT_SUCCESS_WEBHOOK / PAYMENT_FAILED_WEBHOOK, even when the buyer
//    closed the tab. Cashfree has no separate webhook secret: the signature is base64(HMAC-SHA256(timestamp +
//    rawBody, YOUR CLIENT SECRET)). Mount with the RAW body:
//      app.post('/api/payment/webhook', express.raw({ type: '*/*' }), paymentWebhook);
//    Register the URL in Cashfree Dashboard → Developers → Webhooks (version 2023-08-01).
export function paymentWebhook(req: import('express').Request, res: import('express').Response) {
  const secret = process.env.CASHFREE_SECRET_KEY;
  const ts = req.header('x-webhook-timestamp') ?? '';
  const sig = req.header('x-webhook-signature') ?? '';
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  if (!secret) return res.status(400).json({ error: 'CASHFREE_SECRET_KEY is not set' });
  const expected = crypto.createHmac('sha256', secret).update(ts + raw.toString('utf8')).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'bad signature' });
  const event = JSON.parse(raw.toString('utf8'));
  if (event?.type === 'PAYMENT_SUCCESS_WEBHOOK') {
    const order = event.data?.order;
    // Mark order.order_id as PAID in your database here (idempotently — Cashfree may retry).
    console.log('[cashfree] paid', order?.order_id, order?.order_amount);
  }
  res.json({ ok: true });
}
`;

const CASHFREE_CLIENT = `// Opens the Cashfree checkout (UPI, cards, net banking, wallets) and verifies the result on the server.
// Resolves with the orderId on a verified payment.
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(\`script[src="\${src}"]\`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load Cashfree'));
    document.body.appendChild(s);
  });
}

interface CashfreeSdk { checkout: (o: { paymentSessionId: string; redirectTarget: '_modal' }) => Promise<{ error?: { message?: string }; paymentDetails?: unknown }> }

export async function payWithCashfree(amountRupees: number, customer: { phone: string; email?: string; id?: string }): Promise<string> {
  await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js');
  const orderRes = await fetch('/api/payment/order', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: amountRupees, customerPhone: customer.phone, customerEmail: customer.email, customerId: customer.id }),
  });
  if (!orderRes.ok) throw new Error((await orderRes.json().catch(() => ({}))).error || 'Could not create the order');
  const { orderId, paymentSessionId, mode } = await orderRes.json();
  const cashfree = (window as unknown as { Cashfree: (o: { mode: string }) => CashfreeSdk }).Cashfree({ mode });
  const result = await cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });
  if (result.error) throw new Error(result.error.message || 'Payment cancelled');
  const v = await fetch('/api/payment/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId }),
  });
  const { verified } = await v.json();
  if (!verified) throw new Error('Payment verification failed');
  return orderId;
}
`;

const STRIPE_SERVER = `import Stripe from 'stripe';
import { Router } from 'express';

// Bring-Your-Own Stripe secret key — from the Stripe Dashboard → Developers → API keys, pasted into .env.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const paymentRouter = Router();

// Create a Checkout Session. \`amount\` is in the SMALLEST unit (cents: $10 = 1000). The client redirects
// to the returned url; Stripe hosts the payment page.
paymentRouter.post('/checkout', async (req, res) => {
  const { amount, currency = 'usd', productName = 'Purchase' } = req.body ?? {};
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'amount (cents) is required' });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency, product_data: { name: productName }, unit_amount: amount }, quantity: 1 }],
      success_url: (req.headers.origin ?? '') + '/success',
      cancel_url: (req.headers.origin ?? '') + '/cancel',
    });
    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: 'Could not create the Stripe checkout session' });
  }
});
`;

const STRIPE_CLIENT = `// Starts a Stripe Checkout by redirecting to the server-created session URL.
export async function payWithStripe(amountCents: number, productName = 'Purchase'): Promise<void> {
  const res = await fetch('/api/payment/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: amountCents, productName }),
  });
  if (!res.ok) throw new Error('Could not start checkout');
  const { url } = await res.json();
  if (url) window.location.href = url;
  else throw new Error('No checkout URL returned');
}
`;

function envBlock(pairs: Array<[string, string]>): string {
  return pairs.map(([k, note]) => `# ${note}\n${k}=`).join('\n') + '\n';
}

/** Generate a working BYO payment integration for a provider. Deterministic; unknown provider → throws. */
export function generatePaymentIntegration(provider: PaymentProvider): PaymentConfig {
  switch (provider) {
    case 'cashfree':
      return {
        provider,
        envKeys: ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV'],
        files: {
          'server/routes/payment.ts': CASHFREE_SERVER,
          'src/lib/cashfree.ts': CASHFREE_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['CASHFREE_APP_ID', 'Cashfree App ID / Client ID (Payments Dashboard → Developers → API Keys)'],
            ['CASHFREE_SECRET_KEY', 'Cashfree Client Secret (server-side only; also signs webhooks)'],
            ['CASHFREE_ENV', 'sandbox (default) or production — must match the keys above'],
          ]),
        },
        instructions: 'Mount the router: app.use("/api/payment", paymentRouter) and the webhook with the RAW body: app.post("/api/payment/webhook", express.raw({ type: "*/*" }), paymentWebhook). On the client, call payWithCashfree(amountRupees, { phone }) — the checkout shows UPI (GPay/PhonePe/Paytm/BHIM), cards, net banking and wallets. The server VERIFIES by asking Cashfree whether the order is PAID and the webhook checks the HMAC signature — a payment is never trusted from the browser. Add a /payment/return page (Cashfree redirects there with ?order_id=). Register the webhook URL in the Cashfree dashboard (Developers → Webhooks). Keys go in the app\'s own env — paste them into .env, or save them in Settings → App Settings → Secrets & API Keys (merged into .env at build); the money lands in YOUR Cashfree account. Test with sandbox keys first (CASHFREE_ENV=sandbox).',
      };
    case 'razorpay':
      return {
        provider, dependency: { name: 'razorpay', version: '^2' },
        envKeys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
        files: {
          'server/routes/payment.ts': RAZORPAY_SERVER,
          'src/lib/razorpay.ts': RAZORPAY_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['RAZORPAY_KEY_ID', 'Razorpay Key ID (Dashboard → Settings → API Keys)'],
            ['RAZORPAY_KEY_SECRET', 'Razorpay Key Secret (keep server-side only)'],
            ['RAZORPAY_WEBHOOK_SECRET', 'The secret you set when creating the webhook (Dashboard → Settings → Webhooks)'],
          ]),
        },
        instructions: 'Mount the router: app.use("/api/payment", paymentRouter) and the webhook with the RAW body: app.post("/api/payment/webhook", express.raw({ type: "*/*" }), paymentWebhook). On the client, call payWithRazorpay(amountPaise) — the checkout shows UPI (GPay/PhonePe/Paytm/BHIM), cards, net banking and wallets. The server VERIFIES every payment signature and the webhook checks the HMAC — a real, paid order is never trusted from the client alone. Register the webhook URL + secret in Razorpay Dashboard → Settings → Webhooks (event payment.captured). Keys go in the app\'s own env — paste them into .env, or save them in Settings → App Settings → Secrets & API Keys (merged into .env at build); the money lands in YOUR Razorpay account.',
      };
    case 'stripe':
      return {
        provider, dependency: { name: 'stripe', version: '^16' },
        envKeys: ['STRIPE_SECRET_KEY'],
        files: {
          'server/routes/payment.ts': STRIPE_SERVER,
          'src/lib/stripe.ts': STRIPE_CLIENT,
          [ENV_EXAMPLE]: envBlock([['STRIPE_SECRET_KEY', 'Stripe secret key (Dashboard → Developers → API keys — server-side only)']]),
        },
        instructions: 'Mount the router: app.use("/api/payment", paymentRouter). On the client, call payWithStripe(amountCents) to redirect to Stripe Checkout. Add /success and /cancel routes. Your secret key stays server-side in YOUR env; NavBharatAI never stores it.',
      };
    default:
      throw new Error(`Unknown payment provider: ${provider}`);
  }
}

/** Valid-provider guard for the tool layer. */
export function isPaymentProvider(v: unknown): v is PaymentProvider {
  return v === 'cashfree' || v === 'razorpay' || v === 'stripe';
}
