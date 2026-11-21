// THE MOBILE-OTP SIGN-IN SWITCH (admin 2026-11-21: suspend OTP login temporarily).
//
// Each sign-in OTP is an SMS the platform pays for. The admin suspended OTP *sign-in* while keeping OTP
// *verification* (VerifyPhoneSheet, purpose 'verify' — proving a number for referral rewards). One setting
// document decides it, so the admin can turn sign-in back on from the panel without a deploy.
//
// 🔒 WHAT THE USER IS TOLD. Only that mobile-number sign-in is temporarily unavailable and which ways in
// still work. The reason is the admin's business decision and is not shown; nothing false is said either
// (no invented "maintenance"). See OTP_LOGIN_SUSPENDED_MESSAGE.
//
// ⚠️ WHAT THIS SWITCH CANNOT STOP. The SMS itself is sent by the auth provider from the CLIENT once this
// server's `/api/auth/send-otp` says yes. Every NavBharatAI client (web, and the installed phone apps,
// which show this server's own message as-is) asks first, so the switch holds for all of them. A client
// built to skip that request entirely would still reach the provider; only disabling the Phone provider
// in the Firebase console stops that, and it would also stop verification. Stated so nobody calls this
// switch a hard wall.
//
// 🟡 Accounts that can ONLY sign in by phone cannot sign in while this is on. Counting them is the next
// step the admin chose (2026-11-21) before the OTP tab is removed for good.

import { getServerDb } from './serverDb';

export const OTP_LOGIN_COLLECTION = 'platform_settings';
export const OTP_LOGIN_DOCUMENT = 'otp_login';
/**
 * With no saved setting, OTP sign-in is SUSPENDED. That is the admin's instruction for this release, and
 * it means the suspension takes effect on deploy without anyone touching the panel.
 */
export const OTP_LOGIN_SUSPENDED_BY_DEFAULT = true;
/** How long one instance trusts its last read. The setting changes rarely; the login page reads it often. */
export const OTP_LOGIN_CACHE_MS = 60_000;

export const OTP_LOGIN_SUSPENDED_CODE = 'otp-login-suspended';
export const OTP_LOGIN_SUSPENDED_MESSAGE =
  'Mobile number sign-in is temporarily unavailable. Please sign in with email, Google or Apple.';

/**
 * The "this number already has an account" refusal while OTP sign-in is suspended. The normal sentence
 * (phoneGate's PHONE_TAKEN_MESSAGE) tells the person to sign in with that number — a door that is shut
 * while suspended, so it must not be offered.
 */
export const PHONE_TAKEN_WHILE_SUSPENDED_MESSAGE =
  'This number is already linked to another NavBharatAI account. Please use a different number.';

export interface OtpLoginSetting {
  suspended: boolean;
  updatedAt: number | null;
}

/** A stored document as a setting; anything unreadable is the default. PURE. */
export function readOtpLoginSetting(data: unknown): OtpLoginSetting {
  const d = (data ?? {}) as { suspended?: unknown; updatedAt?: unknown };
  return {
    suspended: typeof d.suspended === 'boolean' ? d.suspended : OTP_LOGIN_SUSPENDED_BY_DEFAULT,
    updatedAt: typeof d.updatedAt === 'number' && Number.isFinite(d.updatedAt) ? d.updatedAt : null,
  };
}

/**
 * May an OTP be sent for this purpose? Verification always may (it is not sign-in). PURE — the route and
 * the test share it.
 */
export function otpLoginAllows(purpose: 'login' | 'verify', setting: Pick<OtpLoginSetting, 'suspended'>): boolean {
  return purpose === 'verify' || !setting.suspended;
}

export interface OtpLoginBackend {
  read(): Promise<unknown>;
  write(value: OtpLoginSetting): Promise<void>;
}

function firestoreBackend(): OtpLoginBackend | null {
  const db = getServerDb();
  if (!db) return null;
  const ref = db.collection(OTP_LOGIN_COLLECTION).doc(OTP_LOGIN_DOCUMENT);
  return {
    read: async () => (await ref.get()).data(),
    write: async (value) => { await ref.set(value); },
  };
}

export class OtpLoginSwitch {
  private value: OtpLoginSetting | null = null;
  private readAt = 0;

  constructor(
    private readonly backend: () => OtpLoginBackend | null = firestoreBackend,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The current setting. A failed read keeps the last known value, or the default when there is none —
   * the default is "suspended", so an outage cannot quietly restart paid SMS. Never throws.
   */
  async read(): Promise<OtpLoginSetting> {
    if (this.value && this.now() - this.readAt < OTP_LOGIN_CACHE_MS) return this.value;
    try {
      const b = this.backend();
      if (!b) return this.value ?? readOtpLoginSetting(undefined);
      this.value = readOtpLoginSetting(await b.read());
      this.readAt = this.now();
      return this.value;
    } catch {
      return this.value ?? readOtpLoginSetting(undefined);
    }
  }

  /** Save the admin's choice. Throws when it cannot be stored, so the panel never shows an unsaved state. */
  async set(suspended: boolean): Promise<OtpLoginSetting> {
    const b = this.backend();
    if (!b) throw new Error('Settings storage is unavailable.');
    const next: OtpLoginSetting = { suspended, updatedAt: this.now() };
    await b.write(next);
    this.value = next;
    this.readAt = this.now();
    return next;
  }
}

export const otpLoginSwitch = new OtpLoginSwitch();
