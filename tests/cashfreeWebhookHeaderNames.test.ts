// Cashfree documents x-webhook-signature / x-webhook-timestamp; the route used to read only x-cf-signature*.
// Both names are accepted now, and verification stays strict.
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

const SECRET = 'whsec_test_header_names';
process.env.CASHFREE_WEBHOOK_SECRET = SECRET;
process.env.VITEST = 'true';

import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { registerPaymentRoutes, cashfreeWebhookSignatureHeaders } from '../src/server/routes/payment';

const webhook = captureRoutes(registerPaymentRoutes, () => {}).get('POST /api/payment/webhook')!;
const body = { type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'ord_nb_hdr_test' } } };
const raw = JSON.stringify(body);
const ts = '1760370000';
const v2 = (t: string) => crypto.createHmac('sha256', SECRET).update(t + raw).digest('base64');

async function deliver(headers: Record<string, string>) {
  const req = mockReq({ body, headers });
  req.rawBody = Buffer.from(raw, 'utf8');
  const res = mockRes();
  await webhook(req, res);
  return res;
}
const status = (res: any) => res.statusCode ?? res._status ?? res.status?.mock?.calls?.at(-1)?.[0];

describe('cashfreeWebhookSignatureHeaders', () => {
  it('reads the documented names', () => {
    expect(cashfreeWebhookSignatureHeaders({ 'x-webhook-signature': 's', 'x-webhook-timestamp': 't' })).toEqual({ signature: 's', timestamp: 't' });
  });
  it('still reads the legacy names', () => {
    expect(cashfreeWebhookSignatureHeaders({ 'x-cf-signature': 's', 'x-cf-signature-timestamp': 't' })).toEqual({ signature: 's', timestamp: 't' });
  });
  it('prefers the documented name when both are sent', () => {
    expect(cashfreeWebhookSignatureHeaders({ 'x-webhook-signature': 'new', 'x-cf-signature': 'old' }).signature).toBe('new');
  });
  it('no header ⇒ empty signature (which the verifier rejects)', () => {
    expect(cashfreeWebhookSignatureHeaders({})).toEqual({ signature: '', timestamp: '' });
  });
});

describe('the webhook route accepts a valid signature under either header name, and nothing else', () => {
  it('x-webhook-signature + x-webhook-timestamp (documented) passes verification', async () => {
    expect(status(await deliver({ 'x-webhook-signature': v2(ts), 'x-webhook-timestamp': ts }))).not.toBe(401);
  });
  it('x-cf-signature + x-cf-signature-timestamp (legacy) passes verification', async () => {
    expect(status(await deliver({ 'x-cf-signature': v2(ts), 'x-cf-signature-timestamp': ts }))).not.toBe(401);
  });
  it('a forged signature is rejected under either name', async () => {
    expect(status(await deliver({ 'x-webhook-signature': 'forged', 'x-webhook-timestamp': ts }))).toBe(401);
    expect(status(await deliver({ 'x-cf-signature': 'forged', 'x-cf-signature-timestamp': ts }))).toBe(401);
  });
  it('a valid signature with the wrong timestamp is rejected', async () => {
    expect(status(await deliver({ 'x-webhook-signature': v2(ts), 'x-webhook-timestamp': '1760370001' }))).toBe(401);
  });
  it('no signature header at all is rejected', async () => {
    expect(status(await deliver({ 'x-webhook-timestamp': ts }))).toBe(401);
  });
});
