// U-4 (verified recipe modules) — UPI payment deep-link + VPA validation (dependency-free, keyless, India-first).
//
// India runs on UPI. The simplest way for a small Indian merchant to collect a payment inside their own app is
// a UPI intent link — `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR` — which any UPI app (GPay, PhonePe,
// Paytm, BHIM) opens directly, no payment gateway, no API key, no merchant onboarding. This is DISTINCT from
// generate_payment (Cashfree/Razorpay gateways with keys + webhooks): this recipe is the zero-infrastructure
// path for "let a user pay me at my own VPA". Two things are always gotten wrong when hand-rolling it: (1)
// params are not URL-encoded, so a payee name with a space or an "&" produces a broken/ambiguous link; (2) the
// amount is passed unformatted, so "10" and "10.5" and "10.567" all reach the UPI app differently (the NPCI
// spec wants exactly two decimals). This recipe ships buildUpiLink() (correct encoding + amount to 2dp + INR)
// and isValidVpa() (the real name@handle format), so the link works on the first tap. Pair it with the QR
// recipe (generateQr(link)) for a scan-to-pay code. Pure client-safe lib (the user taps it on their own phone),
// no dependency, no env keys. PURE builder; correct and complete — no TODO stubs. Unit-tested.

export interface UpiConfig {
  files: Record<string, string>;
  instructions: string;
}

const UPI_LIB = `// UPI payment deep-link + VPA validation. Dependency-free, keyless — the zero-gateway way for an Indian
// merchant to collect a payment at their OWN VPA (virtual payment address, e.g. "merchant@okhdfcbank"). The
// link opens any UPI app (GPay, PhonePe, Paytm, BHIM) directly. For a gateway with webhooks/refunds, use a
// payment provider instead; this is for direct peer/merchant collection.

export interface UpiParams {
  /** Payee VPA, e.g. "merchant@okhdfcbank". Required. */
  payeeVpa: string;
  /** Payee display name shown in the UPI app. Required. */
  payeeName: string;
  /** Amount in rupees. Omit for a "user enters the amount" open collect link. */
  amount?: number;
  /** Short note / transaction message shown to the payer. */
  note?: string;
  /** Your own transaction reference id (helps you reconcile). */
  transactionRef?: string;
}

// A VPA is "handle-name@bank-handle": the local part allows letters, digits, dot, hyphen and underscore; the
// handle is letters/digits (optionally dotted). This mirrors what the UPI apps actually accept.
const VPA_RE = /^[a-zA-Z0-9.\\-_]{1,256}@[a-zA-Z][a-zA-Z0-9.]{1,64}$/;

/** True if \`vpa\` is a syntactically valid UPI address (name@handle). Validate BEFORE building a link. */
export function isValidVpa(vpa: string): boolean {
  return typeof vpa === 'string' && VPA_RE.test(vpa.trim());
}

/**
 * Build a \`upi://pay?...\` intent link. Throws if the VPA is invalid or the amount is not a positive finite
 * number, so a broken link can never reach a payer. Every param is URL-encoded; the amount is fixed to exactly
 * two decimals and the currency is INR (the UPI spec).
 */
export function buildUpiLink(params: UpiParams): string {
  const vpa = String(params.payeeVpa ?? '').trim();
  if (!isValidVpa(vpa)) throw new Error('Invalid UPI VPA (expected name@handle): ' + JSON.stringify(params.payeeVpa));
  const name = String(params.payeeName ?? '').trim();
  if (!name) throw new Error('payeeName is required for a UPI link');

  const q: string[] = [
    'pa=' + encodeURIComponent(vpa),
    'pn=' + encodeURIComponent(name),
    'cu=INR',
  ];
  if (params.amount !== undefined) {
    if (typeof params.amount !== 'number' || !Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error('UPI amount must be a positive number (rupees), got: ' + String(params.amount));
    }
    q.push('am=' + encodeURIComponent(params.amount.toFixed(2)));
  }
  if (params.note) q.push('tn=' + encodeURIComponent(String(params.note).slice(0, 80)));
  if (params.transactionRef) q.push('tr=' + encodeURIComponent(String(params.transactionRef)));
  return 'upi://pay?' + q.join('&');
}
`;

const UPI_TEST = `import { describe, it, expect } from 'vitest';
import { buildUpiLink, isValidVpa } from './upi';

describe('upi', () => {
  it('validates real VPAs and rejects junk', () => {
    expect(isValidVpa('merchant@okhdfcbank')).toBe(true);
    expect(isValidVpa('a.b-c_1@ybl')).toBe(true);
    expect(isValidVpa('no-handle')).toBe(false);
    expect(isValidVpa('@ybl')).toBe(false);
    expect(isValidVpa('name@')).toBe(false);
    expect(isValidVpa('name@1bank')).toBe(false);
  });

  it('builds a valid pay link with amount fixed to 2 decimals and INR', () => {
    const link = buildUpiLink({ payeeVpa: 'merchant@okhdfcbank', payeeName: 'Chai Shop', amount: 10.5 });
    expect(link).toContain('upi://pay?');
    expect(link).toContain('pa=merchant%40okhdfcbank');
    expect(link).toContain('pn=Chai%20Shop');
    expect(link).toContain('am=10.50');
    expect(link).toContain('cu=INR');
  });

  it('URL-encodes a name/note containing spaces and ampersands', () => {
    const link = buildUpiLink({ payeeVpa: 'm@ybl', payeeName: 'Ram & Sons', note: 'order #7 (thanks)' });
    expect(link).toContain('pn=Ram%20%26%20Sons');
    expect(link).toContain('tn=order%20%237%20(thanks)');
  });

  it('omits am= for an open collect link (user enters amount)', () => {
    const link = buildUpiLink({ payeeVpa: 'm@ybl', payeeName: 'Store' });
    expect(link).not.toContain('am=');
  });

  it('throws on an invalid VPA or non-positive amount instead of emitting a broken link', () => {
    expect(() => buildUpiLink({ payeeVpa: 'bad', payeeName: 'X' })).toThrow(/VPA/);
    expect(() => buildUpiLink({ payeeVpa: 'm@ybl', payeeName: '' })).toThrow(/payeeName/);
    expect(() => buildUpiLink({ payeeVpa: 'm@ybl', payeeName: 'X', amount: 0 })).toThrow(/positive/);
    expect(() => buildUpiLink({ payeeVpa: 'm@ybl', payeeName: 'X', amount: -5 })).toThrow(/positive/);
  });
});
`;

const INSTRUCTIONS =
  'UPI payment deep-link wired at src/lib/upi.ts (no dependency, no API key — India-first). Call ' +
  "buildUpiLink({ payeeVpa: 'merchant@okhdfcbank', payeeName: 'My Shop', amount: 100, note: 'Order #7' }) to " +
  'get a `upi://pay?...` link that opens GPay/PhonePe/Paytm/BHIM directly for a real payment to YOUR VPA — no ' +
  'payment gateway needed. Validate the merchant VPA first with isValidVpa(vpa). Omit `amount` for an open ' +
  'collect link where the payer types the amount. Render it as a tappable link on mobile, and pass it to the ' +
  'QR recipe (generateQr(link)) for a scan-to-pay code. For a full gateway with webhooks/refunds, use a ' +
  'payment provider recipe instead; this is the zero-infrastructure direct-collect path.';

export function generateUpiIntegration(): UpiConfig {
  return {
    files: {
      'src/lib/upi.ts': UPI_LIB,
      'src/lib/upi.test.ts': UPI_TEST,
    },
    instructions: INSTRUCTIONS,
  };
}
