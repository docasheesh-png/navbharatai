/**
 * Mobile-OTP SIGN-IN can be suspended by the admin (2026-11-21); OTP VERIFICATION keeps working.
 *
 * The class being locked: "a door the server has shut is still offered on a screen". The OTP tab, the
 * "sign in with this number instead" button and App Lock's "sign in again" (which signs a phone-only person
 * OUT) all lead to an OTP sign-in. Each is offered only when the server says OTP sign-in is on.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OtpLoginSwitch, readOtpLoginSetting, otpLoginAllows, OTP_LOGIN_CACHE_MS, OTP_LOGIN_SUSPENDED_BY_DEFAULT,
  OTP_LOGIN_SUSPENDED_CODE as SERVER_CODE, OTP_LOGIN_SUSPENDED_MESSAGE, PHONE_TAKEN_WHILE_SUSPENDED_MESSAGE,
} from '../src/server/lib/otpLoginSwitch';
import { fetchOtpLoginOffered, OTP_LOGIN_SUSPENDED_CODE as CLIENT_CODE } from '../src/lib/signInOptions';
import { registerAuthRoutes } from '../src/server/routes/auth';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

const read = (p: string) => readFileSync(p, 'utf8');

describe('the setting', () => {
  it('with nothing saved, OTP sign-in is suspended (the admin instruction for this release)', () => {
    expect(OTP_LOGIN_SUSPENDED_BY_DEFAULT).toBe(true);
    expect(readOtpLoginSetting(undefined).suspended).toBe(true);
    expect(readOtpLoginSetting({ suspended: 'no' }).suspended).toBe(true);
    expect(readOtpLoginSetting({ suspended: false, updatedAt: 5 })).toEqual({ suspended: false, updatedAt: 5 });
  });
  it('verification is never blocked; sign-in only while suspended', () => {
    expect(otpLoginAllows('verify', { suspended: true })).toBe(true);
    expect(otpLoginAllows('login', { suspended: true })).toBe(false);
    expect(otpLoginAllows('login', { suspended: false })).toBe(true);
  });
  it('the user-facing sentences give no reason and name the ways in that still work', () => {
    expect(OTP_LOGIN_SUSPENDED_MESSAGE).toMatch(/temporarily unavailable/);
    expect(OTP_LOGIN_SUSPENDED_MESSAGE).toMatch(/email, Google or Apple/);
    expect(OTP_LOGIN_SUSPENDED_MESSAGE + PHONE_TAKEN_WHILE_SUSPENDED_MESSAGE).not.toMatch(/cost|expens|kharch|maintenance|sign in with this number/i);
  });
  it('client and server agree on the refusal code', () => {
    expect(CLIENT_CODE).toBe(SERVER_CODE);
  });
});

describe('OtpLoginSwitch', () => {
  it('reads once per cache window and keeps the admin choice after a save', async () => {
    let t = 0; let stored: unknown = { suspended: false, updatedAt: 1 };
    const backend = { read: vi.fn(async () => stored), write: vi.fn(async (v: unknown) => { stored = v; }) };
    const sw = new OtpLoginSwitch(() => backend, () => t);
    expect((await sw.read()).suspended).toBe(false);
    await sw.read();
    expect(backend.read).toHaveBeenCalledTimes(1);
    t += OTP_LOGIN_CACHE_MS;
    await sw.read();
    expect(backend.read).toHaveBeenCalledTimes(2);
    expect((await sw.set(true)).suspended).toBe(true);
    expect((await sw.read()).suspended).toBe(true);
  });
  it('an unreadable setting means suspended — an outage never restarts paid SMS', async () => {
    const sw = new OtpLoginSwitch(() => ({ read: async () => { throw new Error('down'); }, write: async () => {} }));
    expect((await sw.read()).suspended).toBe(true);
    expect((await new OtpLoginSwitch(() => null).read()).suspended).toBe(true);
  });
  it('a save that cannot be stored throws, so the panel never shows an unsaved state', async () => {
    await expect(new OtpLoginSwitch(() => null).set(false)).rejects.toThrow();
  });
});

describe('fetchOtpLoginOffered — only an explicit yes offers the tab', () => {
  const answer = (status: number, body: unknown) => (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;
  it('yes / no / broken answers', async () => {
    expect(await fetchOtpLoginOffered(answer(200, { otpLogin: true }))).toBe(true);
    expect(await fetchOtpLoginOffered(answer(200, { otpLogin: false }))).toBe(false);
    expect(await fetchOtpLoginOffered(answer(200, {}))).toBe(false);
    expect(await fetchOtpLoginOffered(answer(503, { otpLogin: true }))).toBe(false);
    expect(await fetchOtpLoginOffered((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe(false);
  });
});

describe('every door to an OTP sign-in follows the server', () => {
  const auth = read('src/server/routes/auth.ts');
  it('send-otp refuses sign-in while suspended, before any rate-limit bookkeeping', () => {
    const route = auth.slice(auth.indexOf("app.post('/api/auth/send-otp'"));
    const gate = route.indexOf('if (!otpLoginAllows(purpose, await otpLoginSwitch.read()))');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(route.indexOf('checkRecordLimits(phoneOtpRecords'));
    expect(route).toMatch(/code: OTP_LOGIN_SUSPENDED_CODE, message: OTP_LOGIN_SUSPENDED_MESSAGE/);
  });
  it('the "number already has an account" refusal does not send people to a shut door', () => {
    expect(auth).toMatch(/\(await otpLoginSwitch\.read\(\)\)\.suspended \? PHONE_TAKEN_WHILE_SUSPENDED_MESSAGE : decision\.message/);
  });
  it('the sign-in screen draws the OTP tab only when offered', () => {
    expect(read('src/components/AuthComponent.tsx')).toMatch(/\{isLogin && otpLoginOffered && \(/);
  });
  it('the verify sheet offers "sign in with this number" only when offered', () => {
    expect(read('src/components/VerifyPhoneSheet.tsx')).toMatch(/\{otpLoginOffered && <button/);
  });
  it('App Lock never signs a phone-only person out unless they can sign back in', () => {
    expect(read('src/components/AppLockGate.tsx')).toMatch(/\{noEmail && otpLoginOffered === true && \(/);
  });
  it('the admin can switch it from the panel, and the change is audited', () => {
    const admin = read('src/server/routes/admin.ts');
    expect(admin).toMatch(/app\.post\('\/api\/admin\/otp-login', verifyAdminToken/);
    expect(admin).toMatch(/audit\('ADMIN_OTP_LOGIN_SWITCH'/);
    expect(read('src/components/AdminDashboard.tsx')).toMatch(/<OtpLoginSwitchCard adminToken=\{adminToken\} \/>/);
  });
});

describe('the real route, with no saved setting (as on deploy)', () => {
  const routes = captureRoutes(registerAuthRoutes);
  it('a sign-in OTP is refused with the neutral message; nothing is sent', async () => {
    const res = mockRes();
    await routes.get('POST /api/auth/send-otp')!(mockReq({ body: { phone: '+919876500001' }, ip: '10.9.9.1' }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: SERVER_CODE, message: OTP_LOGIN_SUSPENDED_MESSAGE });
  });
  it('the sign-in screen is told OTP sign-in is not offered', async () => {
    const res = mockRes();
    await routes.get('GET /api/auth/sign-in-options')!(mockReq({}), res);
    expect(res.body).toEqual({ otpLogin: false });
  });
});
