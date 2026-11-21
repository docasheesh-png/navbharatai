// WHICH SIGN-IN METHODS THE SERVER OFFERS RIGHT NOW (2026-11-21).
//
// Mobile-OTP sign-in can be suspended by the admin (src/server/lib/otpLoginSwitch.ts). The login screen asks
// `/api/auth/sign-in-options` before drawing the OTP tab. Anything but an explicit `otpLogin: true` reads as
// "not offered": a network failure or an older server must never put a suspended, paid method back on screen.

/** Must match the server's `OTP_LOGIN_SUSPENDED_CODE` (tests/otpLoginSwitch.test.ts checks they agree). */
export const OTP_LOGIN_SUSPENDED_CODE = 'otp-login-suspended';

/** True only when the server answered OK with `otpLogin: true`. Never throws. */
export async function fetchOtpLoginOffered(fetcher: typeof fetch): Promise<boolean> {
  try {
    const res = await fetcher('/api/auth/sign-in-options', { headers: { Accept: 'application/json' } });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return !!body && typeof body === 'object' && (body as { otpLogin?: unknown }).otpLogin === true;
  } catch {
    return false;
  }
}
