/**
 * Round-8 — Cashfree webhook signature must be verified over the RAW received bytes, never over a
 * re-serialized JSON.stringify(req.body). Re-serializing changes whitespace/key-order/escaping, so a
 * legitimate webhook's HMAC would never match → 401 for every real webhook → the server-side payment
 * fulfillment safety net silently dies (paid user who drops off the client poll is charged, not credited).
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { isValidCashfreeSignature } from '../src/server/routes/payment';

const SECRET = 'whsec_test_secret';
// Bytes exactly as a webhook sender might send them — note the spaces after colons/commas, which
// JSON.stringify(JSON.parse(...)) strips, changing the bytes.
const RAW_BODY = '{"type": "PAYMENT_SUCCESS_WEBHOOK", "data": {"order": {"order_id": "ord_nb_1"}}}';
const TS = '1700000000';

describe('isValidCashfreeSignature', () => {
  it('validates a v2 signature computed over timestamp + RAW bytes', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(TS + RAW_BODY).digest('base64');
    expect(isValidCashfreeSignature({ rawBody: RAW_BODY, timestamp: TS, signature: sig, secret: SECRET })).toBe(true);
  });

  it('validates legacy v1 base64 and hex signatures over the RAW bytes', () => {
    const b64 = crypto.createHmac('sha256', SECRET).update(RAW_BODY).digest('base64');
    const hex = crypto.createHmac('sha256', SECRET).update(RAW_BODY).digest('hex');
    expect(isValidCashfreeSignature({ rawBody: RAW_BODY, timestamp: TS, signature: b64, secret: SECRET })).toBe(true);
    expect(isValidCashfreeSignature({ rawBody: RAW_BODY, timestamp: TS, signature: hex, secret: SECRET })).toBe(true);
  });

  it('REGRESSION: re-serialized JSON produces different bytes, so the old JSON.stringify path would reject a real webhook', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(TS + RAW_BODY).digest('base64');
    const reSerialized = JSON.stringify(JSON.parse(RAW_BODY));
    // Proof the bug is real: the parsed-then-restringified body is NOT the same bytes.
    expect(reSerialized).not.toBe(RAW_BODY);
    // Verifying the SAME (valid) signature against the re-serialized bytes fails — which is exactly
    // what the buggy `body = JSON.stringify(req.body)` did to every legitimate webhook.
    expect(isValidCashfreeSignature({ rawBody: reSerialized, timestamp: TS, signature: sig, secret: SECRET })).toBe(false);
  });

  it('rejects a forged signature, an empty signature, and a missing secret', () => {
    expect(isValidCashfreeSignature({ rawBody: RAW_BODY, timestamp: TS, signature: 'forged', secret: SECRET })).toBe(false);
    expect(isValidCashfreeSignature({ rawBody: RAW_BODY, timestamp: TS, signature: '', secret: SECRET })).toBe(false);
    expect(isValidCashfreeSignature({ rawBody: RAW_BODY, timestamp: TS, signature: 'anything', secret: '' })).toBe(false);
  });
});
