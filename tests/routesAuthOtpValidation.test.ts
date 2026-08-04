import { describe, it, expect } from 'vitest';
import { registerAuthRoutes } from '../src/server/routes/auth';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// SEC (input validation, 2026-07-19) — the send-OTP gateway used to check `phone` for truthiness
// only, then call `phone.replace(...)`. A non-string phone (number/object/array) is truthy but has
// no .replace → the handler threw and answered 500 on malformed input. It must reject cleanly (400).
describe('auth /api/auth/send-otp — input type validation', () => {
  const routes = captureRoutes(registerAuthRoutes);
  const handler = () => routes.get('POST /api/auth/send-otp')!;

  it('registers the endpoint', () => {
    expect(routes.has('POST /api/auth/send-otp')).toBe(true);
  });

  it('missing phone → 400 (not 500)', () => {
    const res = mockRes();
    handler()(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it.each([
    ['a number', 9876543210],
    ['an object', { toString: () => '999' }],
    ['an array', ['9876543210']],
    ['a boolean', true],
  ])('non-string phone (%s) → 400, never a 500 crash', (_label, badPhone) => {
    const res = mockRes();
    handler()(mockReq({ body: { phone: badPhone } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('an over-long phone string → 400', () => {
    const res = mockRes();
    handler()(mockReq({ body: { phone: '1'.repeat(50) } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('a valid string phone → 200 success (cooldown validated)', () => {
    const res = mockRes();
    handler()(mockReq({ body: { phone: '+91 98765-43210' }, headers: { 'x-forwarded-for': '203.0.113.5' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
