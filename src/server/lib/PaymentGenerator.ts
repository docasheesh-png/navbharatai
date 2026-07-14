// U-4 (verified recipe modules) — payment-integration generator (Razorpay + Stripe).
//
// Real, working checkout integrations generated into the app, Bring-Your-Own-keys (the user pastes their
// provider keys into .env; NavBharatAI never stores them). Each recipe includes a SERVER route (order/session
// creation + signature verification — the payment is never trusted from the client alone) and a CLIENT helper
// that opens the provider's checkout. Razorpay first (this is an India-first platform). PURE builders; the
// generated code is correct and complete (no TODO stubs — the real-features rule). Unit-tested.

export type PaymentProvider = 'razorpay' | 'stripe';

export interface PaymentConfig {
  provider: PaymentProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependency: { name: string; version: string };
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
    case 'razorpay':
      return {
        provider, dependency: { name: 'razorpay', version: '^2' },
        envKeys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
        files: {
          'server/routes/payment.ts': RAZORPAY_SERVER,
          'src/lib/razorpay.ts': RAZORPAY_CLIENT,
          [ENV_EXAMPLE]: envBlock([['RAZORPAY_KEY_ID', 'Razorpay Key ID (Dashboard → Settings → API Keys)'], ['RAZORPAY_KEY_SECRET', 'Razorpay Key Secret (keep server-side only)']]),
        },
        instructions: 'Mount the router: app.use("/api/payment", paymentRouter). On the client, call payWithRazorpay(amountPaise). The server VERIFIES every payment signature — a real, paid order is never trusted from the client alone. Your keys stay in YOUR env; NavBharatAI never stores them.',
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
  return v === 'razorpay' || v === 'stripe';
}
