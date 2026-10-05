// NavBharatAI's OWN Cashfree merchant credentials — the only place payment code reads them.
//
// 🔴 WHY (forensic audit 2026-10-04, P0). Order creation (`routes/payment.ts`) and payment verification
// (`lib/payments.ts`) read the merchant credentials through `getSecretValue(userId, …)`, a helper that
// checks the server environment and then the CALLER'S OWN secret vault. Production sets the
// `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` pair, so a lookup of the other pair's names
// (`CASHFREE_CLIENT_ID` / `CASHFREE_CLIENT_SECRET`) missed the environment and found whatever the user
// had saved under those names. A user who saved their own sandbox merchant keys could create an order in
// THEIR sandbox, "pay" it with a test UPI id, and have verification — asking THEIR sandbox — credit
// real wallet money. The webhook secret had the same shape.
//
// Platform credentials are platform configuration: they come from the server environment and from
// nowhere a user can write. The two copies of the sandbox-vs-production decision had also drifted (one
// read the client id and `sim_`, the other did not), so an order could be created against one Cashfree
// host and verified against the other; it is decided once, here.

export type CashfreeMode = 'sandbox' | 'production';

export interface CashfreeCredentials {
  clientId: string;
  clientSecret: string;
  mode: CashfreeMode;
  /** True when either value is missing or an obvious placeholder — no real call can be made. */
  placeholder: boolean;
}

function looksLikeTest(id: string, secret: string): boolean {
  const s = secret.toLowerCase();
  const i = id.toLowerCase();
  return s.includes('test') || s.includes('sandbox') || s.includes('sim_') || secret.toUpperCase().startsWith('TEST')
    || i.includes('test') || i.includes('sandbox') || id.toUpperCase().startsWith('TEST');
}

/** The merchant credentials from the server environment. Never takes a user id — that is the point. */
export function platformCashfreeCredentials(env: NodeJS.ProcessEnv = process.env): CashfreeCredentials {
  const clientId = (env.CASHFREE_CLIENT_ID || env.CASHFREE_APP_ID || '').trim();
  const clientSecret = (env.CASHFREE_CLIENT_SECRET || env.CASHFREE_SECRET_KEY || '').trim();
  const explicit = (env.CASHFREE_ENV || '').trim().toLowerCase();
  const mode: CashfreeMode = explicit === 'sandbox' || explicit === 'production'
    ? explicit
    : (looksLikeTest(clientId, clientSecret) ? 'sandbox' : 'production');
  const placeholder = !clientId || !clientSecret
    || clientId.toLowerCase().includes('placeholder') || clientSecret.toLowerCase().includes('placeholder');
  return { clientId, clientSecret, mode, placeholder };
}

/**
 * Can real payments be taken right now? ONE decision for order creation and verification (Q-615, admin
 * 2026-10-05: "asli kaam karne wala payment rakho, sabhi fake hatao").
 *
 * There is no simulator any more. Missing or placeholder keys mean payments are honestly unavailable —
 * they used to open a "simulated gateway" whose PASS button credited a wallet with no money moved. And a
 * production server never takes TEST money: sandbox-mode keys there are a misconfiguration, refused rather
 * than allowed to credit a live wallet from a test payment. Outside production, Cashfree's own sandbox is
 * a real gateway (real API, test cards) and stays available to developers.
 */
export type PaymentsAvailability =
  | ({ ok: true } & CashfreeCredentials)
  | { ok: false; code: 'payments_unconfigured' | 'payments_test_mode_in_production'; message: string };

export function cashfreePaymentsAvailability(env: NodeJS.ProcessEnv = process.env): PaymentsAvailability {
  const creds = platformCashfreeCredentials(env);
  if (creds.placeholder) {
    return { ok: false, code: 'payments_unconfigured', message: 'Payments are not available right now. Please try again later.' };
  }
  if (creds.mode === 'sandbox' && env.NODE_ENV === 'production') {
    return { ok: false, code: 'payments_test_mode_in_production', message: 'Payments are not available right now. Please try again later.' };
  }
  return { ok: true, ...creds };
}

/** The webhook signing secret from the server environment, or null when it is not configured. */
export function platformCashfreeWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = (env.CASHFREE_WEBHOOK_SECRET || '').trim();
  return s || null;
}
