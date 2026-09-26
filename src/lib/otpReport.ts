// Tell the server how a mobile-OTP attempt ended, so the admin can see WHY OTP fails without a phone's
// developer console (see otpFailure.ts for the incident). Fire-and-forget: it never throws, is never
// awaited by a sign-in, and a lost report costs one line of a day's tally — never a sign-in.
//
// 🔒 NOTHING IN IT NAMES A PERSON: no phone number, no uid. `detail` is already scrubbed of numbers and
// tokens by `otpFailureDetail`, and the server scrubs and bounds it again.

import { otpFailureCategory, otpFailureDetail, type OtpFailureCategory } from './otpFailure';

export type OtpOutcome = 'sent' | 'failed' | 'verified';
export type OtpStage = 'gateway' | 'send' | 'verify';
export type OtpFlow = 'sign-in' | 'link';

export interface OtpReport {
  outcome: OtpOutcome;
  surface: string;
  flow: OtpFlow;
  stage?: OtpStage;
  category?: OtpFailureCategory;
  detail?: string;
}

/** The body for one failure. PURE. */
export function otpFailureReport(err: unknown, surface: string, flow: OtpFlow, stage: OtpStage): OtpReport {
  return { outcome: 'failed', surface, flow, stage, category: otpFailureCategory(err), detail: otpFailureDetail(err) };
}

/** `android` / `ios` / `web`, never throws. */
export function otpSurface(platform: () => string): string {
  try {
    const p = String(platform() || '').toLowerCase();
    return p === 'android' || p === 'ios' ? p : 'web';
  } catch { return 'web'; }
}

export function sendOtpReport(report: OtpReport, f: typeof fetch = fetch): void {
  try {
    void f('/api/auth/otp-outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => { /* a lost report is one line of a tally */ });
  } catch { /* never affects sign-in */ }
}
