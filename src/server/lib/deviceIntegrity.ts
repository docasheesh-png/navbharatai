// IS THIS A REAL ANDROID PHONE, AND WHICH ONE? — the gate every referral rupee sits behind.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// The referral plan pays ₹400 to a new user and ₹75 to whoever brought them (`referralRewards.ts`).
// Every one of those rupees is protected by exactly one idea: **a physical Android handset is a
// scarce thing, and a free email address is not.** Before this module, the platform had no way to
// know one device from another, so the scarce thing did not exist and the whole plan would have
// been a ₹0-cost printer: a fresh Gmail and a fresh GitHub account take three minutes on a laptop.
//
// Two questions, two different answers, and they are NOT interchangeable:
//
//   1. "Is this a genuine device running our genuine app from Play?"  → GOOGLE answers this.
//      Play Integrity is the only thing that can, because it is attested by hardware we do not own
//      and signed by a key we do not hold. It is what stops an emulator farm — 500 fake phones on
//      one computer, the standard machinery of ad fraud — and a patched APK that simply lies.
//   2. "WHICH device is this?"  → the device answers, with ANDROID_ID.
//      Stable for our app on that handset across reinstalls and new accounts, and scoped to our
//      signing key so no other app shares it. It RESETS ON A FACTORY RESET, which is the honest
//      limit of the whole design and is written down rather than wished away: it bounds how many
//      accounts can exist at once, not how often one determined person can come back. That second
//      bound is the phone number's job (`referralRewards.ts` rule 3), which is why both exist.
//
// 🔒 THE DEVICE'S OWN CLAIM IS WORTHLESS ON ITS OWN. Anyone can POST an ANDROID_ID; it is a string.
// It becomes evidence only when it arrives beside an integrity verdict Google signed for OUR package
// in the same moment. So this module NEVER accepts an id without a verdict — the storeVerify.ts
// discipline exactly: "THE DEVICE IS NEVER TRUSTED. It sends an opaque id/token; we ask the store."
//
// 🔒 AND IT FAILS CLOSED, WHICH IS THE OPPOSITE OF MOST GATES IN THIS REPO AND DELIBERATE. A lease
// this platform cannot read runs the job anyway; a budget it cannot read spends nothing. Here, an
// unreachable Google, an unconfigured service account, a malformed token and an outright forgery all
// produce the SAME answer — not verified, therefore no money. Being wrong in the open direction
// would hand out real credit on no evidence, and there is no later gate to catch it.

import { googleAccessToken, PLAY_INTEGRITY_SCOPE } from './storeVerify';

/** What the platform concludes about the caller. */
export type DeviceVerdict = 'verified' | 'not-verified' | 'unavailable';

export interface DeviceCheck {
  verdict: DeviceVerdict;
  /** The stable per-device id, present ONLY on a verified check. Never read from an unverified one. */
  deviceId: string | null;
  /** Admin-facing detail. Never shown to a user — see `deviceRefusalMessage`. */
  detail: string;
}

/**
 * Google's verdict fields, as documented for `decodeIntegrityToken`. Modelled loosely on purpose:
 * Google adds fields over time, and a strict shape would turn a harmless addition into a refusal.
 */
interface IntegrityPayload {
  requestDetails?: { requestPackageName?: string; timestampMillis?: string; requestHash?: string };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  accountDetails?: { appLicensingVerdict?: string };
}

type JsonFetch = (url: string, init?: {
  method?: string; headers?: Record<string, string>; body?: string;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let _fetchImpl: JsonFetch = fetch as unknown as JsonFetch;
/** Test seam — Google is not reachable from CI, and a device gate must still be provable. */
export function _setIntegrityFetchForTests(f: JsonFetch | null): void {
  _fetchImpl = f ?? (fetch as unknown as JsonFetch);
}

/** Master switch. Unset ⇒ every check is `unavailable`, so nothing pays. Default OFF. */
export function deviceCheckConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.GOOGLE_PLAY_SA_JSON || '').trim() && (env.GOOGLE_PLAY_PACKAGE_NAME || '').trim());
}

/**
 * How old a token may be. Google's token carries the moment the DEVICE asked, so a replayed one is
 * an old one — and replay is the obvious attack here: capture one genuine token from one real phone
 * and post it for a thousand accounts.
 *
 * ⚠️ Five minutes, not five seconds. The token is minted on the device and travels through a real
 * mobile network, a cold app start and possibly a retry; too tight a window rejects honest users on
 * a bad signal, which is the failure nobody sees because those users simply leave. The replay window
 * this leaves open is closed by the DEVICE MARKER instead — one device earns once, ever — so a
 * replayed token buys a second payout on an id that has already been spent.
 */
export const INTEGRITY_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Read Google's decoded payload and decide.
 *
 * PURE — this is the half worth testing exhaustively, because every field here is a decision about
 * money and none of them can be exercised against the real Google from CI.
 */
export function judgeIntegrityPayload(
  payload: unknown,
  expect: { packageName: string; now: number },
): { ok: boolean; detail: string } {
  const p = (payload || {}) as IntegrityPayload;

  // 1. IS IT OUR APP AT ALL? A token for a different package is either a mistake or someone
  //    replaying another app's evidence at us.
  const pkg = p.requestDetails?.requestPackageName || p.appIntegrity?.packageName || '';
  if (!pkg) return { ok: false, detail: 'no package name in the integrity payload' };
  if (pkg !== expect.packageName) return { ok: false, detail: `integrity token is for ${pkg}` };

  // 2. IS IT OUR UNMODIFIED BINARY, FROM PLAY? `PLAY_RECOGNIZED` is the only acceptable answer.
  //    `UNRECOGNIZED_VERSION` means a modified or sideloaded build — which is precisely the thing
  //    someone would build to fake the rest of this, so it can never be waved through.
  const app = p.appIntegrity?.appRecognitionVerdict || '';
  if (app !== 'PLAY_RECOGNIZED') return { ok: false, detail: `app verdict ${app || 'missing'}` };

  // 3. IS IT A REAL PHONE? MEETS_DEVICE_INTEGRITY excludes emulators and most rooted devices.
  //    We deliberately do NOT require MEETS_STRONG_INTEGRITY: that additionally demands a recent
  //    security update, which would refuse a large share of genuine, older Indian handsets — the
  //    exact users this product is for. Refusing them to catch a few more fraudsters is a bad trade.
  const device = p.deviceIntegrity?.deviceRecognitionVerdict || [];
  if (!Array.isArray(device) || !device.includes('MEETS_DEVICE_INTEGRITY')) {
    return { ok: false, detail: `device verdict ${JSON.stringify(device)}` };
  }

  // 4. IS IT FRESH? See INTEGRITY_MAX_AGE_MS.
  const ts = Number(p.requestDetails?.timestampMillis);
  if (!Number.isFinite(ts)) return { ok: false, detail: 'no timestamp in the integrity payload' };
  const age = expect.now - ts;
  // A token from the FUTURE is as wrong as a stale one, and a generous allowance for clock skew is
  // not a kindness here: it is how a replay window is reopened from the other side.
  if (age > INTEGRITY_MAX_AGE_MS || age < -60_000) {
    return { ok: false, detail: `integrity token age ${Math.round(age / 1000)}s` };
  }

  return { ok: true, detail: 'device verified' };
}

/** A device id is a short opaque hex string. Anything else is a client that is not our app. */
export function normalizeDeviceId(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(s)) return null;
  return s;
}

/**
 * Ask Google about one integrity token, and return the verdict for this device.
 *
 * 🔒 `unavailable` vs `not-verified` is a real distinction and both pay ZERO. They are kept apart so
 * the ADMIN can tell "our Google setup is broken" from "somebody is trying it on" — one of those is
 * an outage costing honest users their bonus, the other is the system working. Collapsing them is
 * how a misconfiguration hides inside a fraud counter for a month.
 */
export async function checkDeviceIntegrity(input: {
  integrityToken: string;
  deviceId: unknown;
  now?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<DeviceCheck> {
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now();
  const nope = (verdict: DeviceVerdict, detail: string): DeviceCheck => ({ verdict, deviceId: null, detail });

  if (!deviceCheckConfigured(env)) return nope('unavailable', 'device check not configured');

  const deviceId = normalizeDeviceId(input.deviceId);
  if (!deviceId) return nope('not-verified', 'missing or malformed device id');

  const token = String(input.integrityToken ?? '').trim();
  if (!token) return nope('not-verified', 'missing integrity token');

  const pkg = (env.GOOGLE_PLAY_PACKAGE_NAME || '').trim();
  const access = await googleAccessToken(Math.floor(now / 1000), PLAY_INTEGRITY_SCOPE, env);
  if (!access) return nope('unavailable', 'could not obtain a Play Integrity access token');

  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await _fetchImpl(
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(pkg)}:decodeIntegrityToken`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrityToken: token }),
      },
    );
  } catch (e) {
    // Google being unreachable is OUR problem, not evidence against the user.
    return nope('unavailable', `play integrity unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  // A 4xx is a rejected TOKEN (the user's side); a 5xx is Google having a bad day (ours).
  if (!res.ok) {
    return nope(res.status >= 500 ? 'unavailable' : 'not-verified', `play integrity HTTP ${res.status}`);
  }

  const body = (await res.json().catch(() => null)) as { tokenPayloadExternal?: unknown } | null;
  if (!body?.tokenPayloadExternal) return nope('not-verified', 'play integrity returned no payload');

  const judged = judgeIntegrityPayload(body.tokenPayloadExternal, { packageName: pkg, now });
  if (!judged.ok) return nope('not-verified', judged.detail);

  return { verdict: 'verified', deviceId, detail: 'device verified' };
}

/**
 * What the USER is told when the check does not pass.
 *
 * Honest about the outcome, silent about the mechanism — the same reasoning as
 * `attributionRefusalMessage`: naming the failing check is the one piece of information an attacker
 * needs and an honest user never does. And it never accuses anybody: the person reading this is far
 * more likely to be on a rooted phone they bought that way, or an older handset, than an attacker.
 */
export function deviceRefusalMessage(verdict: DeviceVerdict): string {
  if (verdict === 'unavailable') {
    return 'We could not check this device just now. Please try again in a few minutes — your account is fine.';
  }
  return 'This bonus can only be claimed in the NavBharatAI app installed from the Google Play Store.';
}
