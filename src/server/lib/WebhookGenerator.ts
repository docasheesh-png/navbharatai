// U-4 (verified recipe modules) — incoming-webhook signature verification (dependency-free, node:crypto).
//
// Any real app that receives webhooks — payment confirmations (Cashfree/Razorpay/Stripe), GitHub events,
// Shopify/WhatsApp callbacks — MUST verify the sender's HMAC signature, or an attacker can forge a "payment
// succeeded" call and get goods for free. The two classic mistakes are (1) comparing signatures with `===`
// (leaks timing → forgeable) and (2) hashing the parsed/re-serialized JSON instead of the exact RAW bytes
// (signature never matches). This recipe ships a correct verifier: HMAC-SHA256 over the RAW body, compared
// with `crypto.timingSafeEqual` (constant-time), tolerant of the common `sha256=<hex>` header prefix. No
// dependency (node:crypto), no env keys the recipe itself invents (the app supplies the provider's secret).
// PURE builder; correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export interface WebhookConfig {
  files: Record<string, string>;
  instructions: string;
}

const WEBHOOK_SERVER = `import crypto from 'node:crypto';

// Verify an incoming webhook's HMAC signature against the RAW request body.
//
// IMPORTANT: pass the EXACT raw bytes the sender signed — NOT JSON.parse(body) re-serialized. In Express,
// capture the raw body for the webhook route only, e.g.:
//   app.post('/webhooks/pay', express.raw({ type: '*/*' }), (req, res) => {
//     if (!verifyWebhookSignature(req.body, req.header('x-signature') || '', process.env.WEBHOOK_SECRET!)) {
//       return res.status(401).send('bad signature');
//     }
//     const event = JSON.parse(req.body.toString('utf8'));
//     // ...trust event now
//   });
//
// Returns true only when the signature is present, well-formed, and matches — using a constant-time compare
// so an attacker can't brute-force it byte-by-byte via response timing. Accepts a bare hex digest or the
// common "sha256=<hex>" / "sha1=<hex>" prefixed form (GitHub/Shopify style).
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string,
  secret: string,
  opts?: { algorithm?: 'sha256' | 'sha1' },
): boolean {
  if (!signatureHeader || !secret) return false;
  const algorithm = opts?.algorithm ?? 'sha256';

  // Strip an optional "sha256=" / "sha1=" prefix.
  const provided = signatureHeader.includes('=')
    ? signatureHeader.slice(signatureHeader.indexOf('=') + 1).trim()
    : signatureHeader.trim();

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = crypto.createHmac(algorithm, secret).update(body).digest('hex');

  // timingSafeEqual throws if the buffers differ in length — guard first (a length mismatch is a mismatch).
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

// Sign a payload yourself (for testing your webhook, or when YOUR app is the sender). Returns the hex digest.
export function signWebhook(rawBody: Buffer | string, secret: string, algorithm: 'sha256' | 'sha1' = 'sha256'): string {
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  return crypto.createHmac(algorithm, secret).update(body).digest('hex');
}
`;

const INSTRUCTIONS =
  'Incoming-webhook verification wired at server/lib/webhook.ts (no dependency — uses node:crypto). Import ' +
  'verifyWebhookSignature(rawBody, signatureHeader, secret) and call it on every webhook route BEFORE trusting ' +
  'the payload — return 401 if it is false. Capture the RAW body for that route (express.raw({ type: "*/*" })) ' +
  'and pass the provider secret (set it in .env yourself, e.g. WEBHOOK_SECRET). It uses a constant-time compare, ' +
  'so signatures cannot be forged by timing, and accepts the common "sha256=<hex>" header form. Use signWebhook() ' +
  'to sign a test payload. No API key needed — the secret comes from your payment/GitHub provider dashboard.';

export function generateWebhookIntegration(): WebhookConfig {
  return {
    files: { 'server/lib/webhook.ts': WEBHOOK_SERVER },
    instructions: INSTRUCTIONS,
  };
}
