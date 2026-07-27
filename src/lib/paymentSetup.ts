// Taking payments in an app — what each method really needs, and the code that is actually safe.
//
// WHY THIS EXISTS (admin 2026-07-27): the Monetization wizard generated a Razorpay integration with a
// serious, exploitable flaw, and it is the method an Indian user reaches for first. The generated code
// was:
//
//     amount: window.payAmount * 100,               // the price came from a browser variable
//     handler: function (response) {                 // "payment succeeded" was decided in the browser
//       alert("Payment successful! ID: " + ...);
//     }
//
// with no order_id and no signature verification anywhere. Razorpay's own documentation is explicit
// that the server must create an Order and then verify `razorpay_signature` with HMAC-SHA256 — without
// that, a customer can open devtools, set `window.payAmount = 1`, and buy a ₹10,000 item for ₹1, or
// call the success handler directly and pay nothing at all. A shop shipping that code gets defrauded.
// Neither the Stripe nor the Cashfree template had this problem; only Razorpay's did.
//
// So this module generates the REAL flow: server creates the order, the browser only opens checkout,
// and the server verifies the signature before anything is treated as paid.
//
// It also encodes the thing that actually makes this simple for an Indian user: UPI needs ONE field
// and no server at all. That is the honest default, and everything else is opt-in complexity.

export type PayMethod = 'upi' | 'razorpay' | 'cashfree' | 'stripe' | 'adsense';

export interface PayField {
  key: string;
  label: string;
  placeholder: string;
  /** Exactly where in the provider's own dashboard this value lives. */
  where?: string;
  /** True when this value must NEVER reach the browser bundle — it goes to the vault only. */
  secret?: boolean;
  optional?: boolean;
}

export interface PayMethodSpec {
  id: PayMethod;
  label: string;
  /** One line a non-technical user can decide on. */
  summary: string;
  /** What it costs the user, in their terms. */
  cost: string;
  /** True when the method works with no server and no signup — the reason UPI comes first. */
  noServerNeeded: boolean;
  dashboardLink?: string;
  fields: PayField[];
}

export const PAY_METHODS: PayMethodSpec[] = [
  {
    id: 'upi',
    label: 'UPI — money straight to your bank',
    summary: 'Customers pay with any UPI app. The money reaches your bank directly. Nothing to sign up for.',
    cost: 'Free — no fees, no account to open',
    noServerNeeded: true,
    fields: [
      {
        key: 'upiId',
        label: 'Your UPI ID',
        placeholder: 'yourname@okaxis',
        where: 'Open your UPI app (GPay, PhonePe, Paytm) → Profile → your UPI ID',
      },
      { key: 'payeeName', label: 'Name to show', placeholder: 'Your shop name', optional: true },
    ],
  },
  {
    id: 'razorpay',
    label: 'Razorpay — cards, netbanking, wallets',
    summary: 'Accepts cards and netbanking as well as UPI. Needs a Razorpay account and a small server.',
    cost: 'Razorpay charges about 2% per payment',
    noServerNeeded: false,
    dashboardLink: 'https://dashboard.razorpay.com/app/keys',
    fields: [
      {
        key: 'keyId',
        label: 'Key ID',
        placeholder: 'rzp_live_xxxxxxxx',
        where: 'Razorpay Dashboard → Account & Settings → API Keys → Key Id',
      },
      {
        key: 'keySecret',
        label: 'Key Secret',
        placeholder: '••••••••••••',
        where: 'Razorpay Dashboard → Account & Settings → API Keys → Key Secret (shown once when you generate it)',
        secret: true,
      },
    ],
  },
  {
    id: 'cashfree',
    label: 'Cashfree — cards, netbanking, wallets',
    summary: 'An alternative to Razorpay with similar features. Also needs an account and a small server.',
    cost: 'Cashfree charges about 2% per payment',
    noServerNeeded: false,
    dashboardLink: 'https://merchant.cashfree.com/merchants/pg/developers/api-keys',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: 'xxxxxxxxxxxx', where: 'Cashfree Dashboard → Developers → API Keys → App ID' },
      { key: 'secretKey', label: 'Secret Key', placeholder: '••••••••••••', where: 'Cashfree Dashboard → Developers → API Keys → Secret Key', secret: true },
    ],
  },
  {
    id: 'stripe',
    label: 'Stripe — customers outside India',
    summary: 'For international cards. Stripe cannot take Indian UPI, so use it alongside UPI rather than instead of it.',
    cost: 'Stripe charges about 3% per payment',
    noServerNeeded: false,
    dashboardLink: 'https://dashboard.stripe.com/apikeys',
    fields: [
      {
        key: 'publishableKey',
        label: 'Publishable key',
        placeholder: 'pk_live_xxxxxxxx',
        where: 'Stripe Dashboard → Developers → API keys → Publishable key',
      },
      {
        key: 'secretKey',
        label: 'Secret key',
        placeholder: '••••••••••••',
        where: 'Stripe Dashboard → Developers → API keys → Secret key (click Reveal)',
        secret: true,
      },
    ],
  },
  {
    id: 'adsense',
    label: 'Google AdSense — earn from ads',
    summary: 'Show ads instead of charging. You need an approved AdSense account, which takes a few days.',
    cost: 'Free to add — Google pays you a share of the ad revenue',
    noServerNeeded: true,
    dashboardLink: 'https://www.google.com/adsense/',
    fields: [
      { key: 'publisherId', label: 'Publisher ID', placeholder: 'ca-pub-1234567890123456', where: 'AdSense → Account → Settings → Account information → Publisher ID' },
      { key: 'slotId', label: 'Ad unit ID', placeholder: '1234567890', where: 'AdSense → Ads → By ad unit → your unit → Ad unit ID' },
    ],
  },
];

export function methodSpec(id: PayMethod): PayMethodSpec {
  return PAY_METHODS.find((m) => m.id === id) || PAY_METHODS[0];
}

/**
 * The vault names each value is stored under.
 *
 * Mirrors what the Database screen already does, so every credential in NavBharatAI lives in the one
 * encrypted vault under a predictable env-var name — and shows up in Settings → Secrets & Keys
 * automatically, wherever the user happened to type it.
 *
 * The VITE_ prefix marks the values that are SAFE in the browser bundle (a Razorpay Key Id and an
 * AdSense publisher id are public by design). Anything without it is server-only, which is exactly the
 * distinction that was missing before.
 */
export function paymentEnvKeys(method: PayMethod, creds: Record<string, string>): Record<string, string> {
  switch (method) {
    case 'upi':
      return {
        VITE_UPI_ID: creds.upiId ?? '',
        VITE_UPI_PAYEE_NAME: creds.payeeName ?? '',
      };
    case 'razorpay':
      return {
        VITE_RAZORPAY_KEY_ID: creds.keyId ?? '',   // public by design — safe in the browser
        RAZORPAY_KEY_SECRET: creds.keySecret ?? '', // server only — never bundled
      };
    case 'cashfree':
      return {
        VITE_CASHFREE_APP_ID: creds.appId ?? '',
        CASHFREE_SECRET_KEY: creds.secretKey ?? '',
      };
    case 'stripe':
      return {
        VITE_STRIPE_PUBLISHABLE_KEY: creds.publishableKey ?? '',
        STRIPE_SECRET_KEY: creds.secretKey ?? '',
      };
    case 'adsense':
      return {
        VITE_ADSENSE_PUBLISHER_ID: creds.publisherId ?? '',
        VITE_ADSENSE_SLOT_ID: creds.slotId ?? '',
      };
    default:
      return {};
  }
}

/**
 * Which required fields are still empty.
 *
 * The gate the wizard's "Add it to my app" button uses. It lives here rather than in the component so
 * it is testable: the old wizard happily generated a UPI link with an empty `pa=` — a button that
 * looked finished and opened a UPI app with no payee.
 */
export function missingRequiredFields(method: PayMethod, creds: Record<string, string>): string[] {
  return methodSpec(method).fields
    .filter((f) => !f.optional && !(creds[f.key] || '').trim())
    .map((f) => f.label);
}

/**
 * The pages a payment button can go on, best first.
 *
 * A button belongs on a page someone actually opens, so the home page is offered before anything
 * else rather than whichever file happened to sort first.
 */
export function candidatePages(paths: string[]): string[] {
  const html = paths.filter((p) => /\.html?$/i.test(p));
  const home = html.filter((p) => /(^|\/)index\.html?$/i.test(p));
  return [...home, ...html.filter((p) => !home.includes(p))];
}

/** A UPI id looks like `name@bank`. Checked so a typo is caught before it reaches a customer. */
export function isValidUpiId(id: string): boolean {
  return /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/.test((id || '').trim());
}

export interface GeneratedPayment {
  /** Markup to add to the page. */
  html: string;
  /** Server code the user must run, when the method needs one. Empty for UPI and AdSense. */
  server?: string;
  /** The file name the server code should be saved as. */
  serverFileName?: string;
  /** Plain-language steps left for the user. */
  nextSteps: string[];
}

function esc(v: string): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * UPI — the simple one, and genuinely complete.
 *
 * A UPI intent link opens the customer's payment app with the amount pre-filled. There is no
 * signature to verify because there is no callback at all: the shopkeeper confirms the payment in
 * their own bank app. That is a real limitation and it is stated in nextSteps rather than glossed
 * over — but for a small seller it is also why UPI is the least trouble.
 */
function generateUpi(creds: Record<string, string>, amount: string): GeneratedPayment {
  const upiId = (creds.upiId || '').trim();
  const name = (creds.payeeName || '').trim();
  const link = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name || 'Payment')}${amount ? `&am=${encodeURIComponent(amount)}` : ''}&cu=INR`;
  return {
    html: `<!-- Pay with UPI — added by NavBharatAI -->
<a href="${esc(link)}"
   style="display:inline-block;background:#f97316;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;">
  Pay${amount ? ` ₹${esc(amount)}` : ''} with UPI
</a>`,
    nextSteps: [
      'Open the page on a phone and tap the button — your UPI app should open with the amount filled in.',
      'UPI does not tell your website when a payment succeeds. Check your bank app or SMS before you deliver the order.',
      'If you need automatic confirmation, use Razorpay or Cashfree instead.',
    ],
  };
}

/**
 * Razorpay — the CORRECT flow, replacing the exploitable one.
 *
 * Three things the old version got wrong, each fixed here:
 *   1. The amount is decided on the SERVER when the order is created, so a customer cannot change it.
 *   2. `order_id` ties the payment to that server-side order.
 *   3. The signature is verified on the server with HMAC-SHA256 before anything is treated as paid —
 *      the browser's success callback is now only a redirect, never proof.
 */
function generateRazorpay(creds: Record<string, string>): GeneratedPayment {
  const keyId = (creds.keyId || '').trim();
  return {
    html: `<!-- Pay with Razorpay — added by NavBharatAI -->
<button id="pay-button"
        style="background:#6366f1;color:#fff;padding:14px 28px;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;">
  Pay now
</button>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
document.getElementById('pay-button').onclick = async function () {
  // The SERVER decides the amount and creates the order. The browser never sets the price —
  // that is what stops a customer paying 1 rupee for a 10,000 rupee item.
  const orderRes = await fetch('/api/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: 'YOUR_ITEM_ID' })
  });
  const order = await orderRes.json();

  const rzp = new Razorpay({
    key: ${JSON.stringify(keyId || 'YOUR_RAZORPAY_KEY_ID')},
    order_id: order.id,
    name: ${JSON.stringify((creds.companyName || 'Your shop').slice(0, 60))},
    handler: async function (response) {
      // This callback is NOT proof of payment — anyone can call it from the console.
      // The server verifies the signature and decides.
      const verify = await fetch('/api/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response)
      });
      const result = await verify.json();
      window.location.href = result.paid ? '/thank-you' : '/payment-failed';
    }
  });
  rzp.open();
};
</script>`,
    serverFileName: 'server/payments.js',
    server: `// Razorpay payments — generated by NavBharatAI.
//
// This file MUST run on your server, never in the browser. It holds the key secret, decides the
// price, and verifies that a payment really happened.
//
// Install:  npm install express razorpay
// Set these environment variables (they are already saved in your NavBharatAI vault):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET

const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');

const router = express.Router();
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// YOUR prices live here, on the server. Never take an amount from the browser.
const PRICES = {
  YOUR_ITEM_ID: 49900, // in paise — 49900 = Rs 499
};

router.post('/api/create-order', async (req, res) => {
  const amount = PRICES[req.body.item];
  if (!amount) return res.status(400).json({ error: 'Unknown item' });

  const order = await razorpay.orders.create({
    amount,               // decided here, not by the customer
    currency: 'INR',
    receipt: 'rcpt_' + Date.now(),
  });
  res.json({ id: order.id, amount: order.amount });
});

router.post('/api/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  // The signature is the ONLY proof a payment is real. Razorpay signs
  // "order_id|payment_id" with your key secret; we recompute it and compare.
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  // timingSafeEqual avoids leaking the answer through how long the comparison takes.
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpay_signature || ''));
  const paid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!paid) return res.status(400).json({ paid: false });

  // Only now is the order genuinely paid. Mark it as such in your database here.
  res.json({ paid: true, paymentId: razorpay_payment_id });
});

module.exports = router;
`,
    nextSteps: [
      'Put the server file on your server and mount it — payments cannot be verified from the browser alone.',
      'Set your real prices in the PRICES list inside that file.',
      'Your Key Secret is saved in the encrypted vault. Read it on your server as RAZORPAY_KEY_SECRET — never put it in a web page.',
      'Test with Razorpay test keys first, then switch to live keys.',
    ],
  };
}

/** Cashfree — same shape as Razorpay: the server creates the order and confirms it. */
function generateCashfree(creds: Record<string, string>): GeneratedPayment {
  return {
    html: `<!-- Pay with Cashfree — added by NavBharatAI -->
<button id="pay-button"
        style="background:#22c55e;color:#fff;padding:14px 28px;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;">
  Pay now
</button>
<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
<script>
document.getElementById('pay-button').onclick = async function () {
  // The server creates the order and returns a payment session. The browser never sets the price.
  const res = await fetch('/api/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: 'YOUR_ITEM_ID' })
  });
  const { paymentSessionId } = await res.json();
  const cashfree = Cashfree({ mode: 'production' });
  cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });
};
</script>`,
    serverFileName: 'server/payments.js',
    server: `// Cashfree payments — generated by NavBharatAI.
//
// Runs on your SERVER only. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY (already in your vault).
// Install:  npm install express axios

const express = require('express');
const axios = require('axios');

const router = express.Router();
const BASE = 'https://api.cashfree.com/pg';
const headers = {
  'x-api-version': '2023-08-01',
  'x-client-id': process.env.CASHFREE_APP_ID,
  'x-client-secret': process.env.CASHFREE_SECRET_KEY,
};

// YOUR prices live here, on the server.
const PRICES = { YOUR_ITEM_ID: 499 };

router.post('/api/create-order', async (req, res) => {
  const amount = PRICES[req.body.item];
  if (!amount) return res.status(400).json({ error: 'Unknown item' });

  const { data } = await axios.post(BASE + '/orders', {
    order_amount: amount,
    order_currency: 'INR',
    customer_details: { customer_id: req.body.customerId || 'guest', customer_phone: req.body.phone || '9999999999' },
  }, { headers });

  res.json({ paymentSessionId: data.payment_session_id, orderId: data.order_id });
});

// Confirm with Cashfree directly — never trust what the browser reports.
router.get('/api/order-status/:orderId', async (req, res) => {
  const { data } = await axios.get(BASE + '/orders/' + req.params.orderId, { headers });
  res.json({ paid: data.order_status === 'PAID' });
});

module.exports = router;
`,
    nextSteps: [
      'Put the server file on your server and mount it.',
      'Set your real prices in the PRICES list inside that file.',
      'After checkout, ask your own server for the order status — never trust what the browser reports.',
      'Your Secret Key is in the encrypted vault as CASHFREE_SECRET_KEY. It must stay on the server.',
    ],
  };
}

/**
 * Stripe — Checkout, which is the flow Stripe itself recommends.
 *
 * The server creates the Checkout Session (so it fixes the price) and the browser only redirects to
 * it. Success is confirmed by asking Stripe for the session's `payment_status`, never by trusting
 * the URL the customer came back on — anyone can type a success URL.
 */
function generateStripe(creds: Record<string, string>): GeneratedPayment {
  const pk = (creds.publishableKey || '').trim();
  return {
    html: `<!-- Pay with Stripe — added by NavBharatAI -->
<button id="pay-button"
        style="background:#635bff;color:#fff;padding:14px 28px;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;">
  Pay now
</button>
<script src="https://js.stripe.com/v3/"></script>
<script>
document.getElementById('pay-button').onclick = async function () {
  // The server creates the Checkout Session and fixes the price. The browser never sets an amount.
  const res = await fetch('/api/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: 'YOUR_ITEM_ID' })
  });
  const session = await res.json();
  const stripe = Stripe(${JSON.stringify(pk || 'YOUR_STRIPE_PUBLISHABLE_KEY')});
  await stripe.redirectToCheckout({ sessionId: session.id });
};
</script>`,
    serverFileName: 'server/payments.js',
    server: `// Stripe payments — generated by NavBharatAI.
//
// Runs on your SERVER only. Set STRIPE_SECRET_KEY (already in your vault).
// Install:  npm install express stripe

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// YOUR prices live here, on the server. Never take an amount from the browser.
const PRICES = {
  YOUR_ITEM_ID: { name: 'Your product', amount: 49900 }, // in the smallest unit — 49900 = Rs 499
};

router.post('/api/create-order', async (req, res) => {
  const item = PRICES[req.body.item];
  if (!item) return res.status(400).json({ error: 'Unknown item' });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'inr',
        product_data: { name: item.name },
        unit_amount: item.amount,   // decided here, not by the customer
      },
      quantity: 1,
    }],
    success_url: 'https://your-site.com/thank-you?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://your-site.com/payment-failed',
  });

  res.json({ id: session.id });
});

// Ask Stripe whether the session was really paid — never trust what the browser reports,
// because anyone can open your success URL directly.
router.get('/api/order-status/:sessionId', async (req, res) => {
  const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
  res.json({ paid: session.payment_status === 'paid' });
});

module.exports = router;
`,
    nextSteps: [
      'Put the server file on your server and mount it.',
      'Set your real prices in the PRICES list inside that file, and your own success and cancel URLs.',
      'On your thank-you page, ask your own server for the order status before you deliver anything.',
      'Stripe does not support Indian UPI. Keep UPI as well if your customers are in India.',
    ],
  };
}

/** AdSense — a plain snippet; nothing here is secret and there is no server. */
function generateAdsense(creds: Record<string, string>): GeneratedPayment {
  const pub = (creds.publisherId || 'ca-pub-XXXXXXXXXXXXXXXX').trim();
  const slot = (creds.slotId || 'XXXXXXXXXX').trim();
  return {
    html: `<!-- Google AdSense — added by NavBharatAI -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(pub)}" crossorigin="anonymous"></script>
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="${esc(pub)}"
     data-ad-slot="${esc(slot)}"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`,
    nextSteps: [
      'Ads only appear once Google has approved your site — that usually takes a few days.',
      'Until then the space stays blank. That is normal and not a mistake in your app.',
    ],
  };
}

/** Build everything for the chosen method. */
export function generatePayment(method: PayMethod, creds: Record<string, string>, amount = ''): GeneratedPayment {
  switch (method) {
    case 'upi': return generateUpi(creds, amount);
    case 'razorpay': return generateRazorpay(creds);
    case 'cashfree': return generateCashfree(creds);
    case 'stripe': return generateStripe(creds);
    case 'adsense': return generateAdsense(creds);
    default: return generateUpi(creds, amount);
  }
}
