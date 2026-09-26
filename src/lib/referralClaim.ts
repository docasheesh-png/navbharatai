// ONE way the app asks the server for a referral reward — shared by the rewards screen, the profile's
// verification card, the notifications checklist and the automatic claim that runs on sign-in.
//
// 🔒 IT DECIDES NOTHING ABOUT MONEY. It only chooses WHICH EVIDENCE to send: the Android app sends the
// Play Integrity device proof and earns the full four-step ladder; every other surface (the website,
// and the iOS shell, which has no device check) sends `platform: 'web'` and is held to the web rules —
// mobile + GitHub only, ₹200 at most, nothing until a real mobile is verified. The server re-decides
// every rupee regardless, so this file can refuse (by not asking) but never grant.
//
// Why it exists: the device-evidence POST was written inline in ReferralPanel and again in
// useHeldReferralCode. A third and fourth caller (auto-claim, the checklist) would have made it four
// drifting copies of the one sentence a user sees when their phone cannot be checked.

import { collectDeviceCheck } from './deviceIntegrityNative';
import { authedHeaders } from './authHeaders';
import { STEP_ORDER, type RewardStep } from './referralStepNames';

export type ReferralSurface = 'android' | 'web';

/** PURE: which rule set a Capacitor platform string gets. Only Android carries the device check. */
export function referralSurfaceFor(platform: string | null | undefined): ReferralSurface {
  return String(platform ?? '').trim().toLowerCase() === 'android' ? 'android' : 'web';
}

/** The surface this app is running on, asked once per call. Anything unknowable is the web. */
export async function currentReferralSurface(): Promise<ReferralSurface> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return referralSurfaceFor(Capacitor.getPlatform());
  } catch {
    return 'web';
  }
}

/**
 * POST to a referral route with the evidence this surface can give. Throws the server's own sentence
 * (written to be actionable and to accuse nobody), or a specific one when the device cannot be checked.
 */
export async function postReferral(
  path: string,
  body: Record<string, unknown>,
  surface: ReferralSurface,
): Promise<{ ok: true; granted?: number; rupees?: number; message?: string }> {
  let evidence: Record<string, unknown> = { platform: 'web' };
  if (surface === 'android') {
    const device = await collectDeviceCheck();
    if (device.outcome !== 'ok') {
      // Tell the server this claim never left the phone — COUNTED there, never paid. Fire-and-forget:
      // a lost report costs one line of the admin's tally, never the user's message below.
      if (/\/claim$/.test(path)) {
        void (async () => {
          try {
            await fetch(path.replace(/\/claim$/, '/claim-failed'), {
              method: 'POST',
              headers: { ...(await authedHeaders()), 'Content-Type': 'application/json' },
              // Google's own message names the cause (an error code such as -16); bounded, and never
              // shown to the user — only the server's count keeps its class.
              body: JSON.stringify({ reason: device.outcome, message: String(device.message ?? '').slice(0, 300) }),
            });
          } catch { /* best-effort */ }
        })();
      }
      throw new Error(device.outcome === 'unavailable'
        ? 'Update the NavBharatAI app from the Play Store to claim this bonus.'
        : 'We could not check this device just now. Please try again in a few minutes.');
    }
    evidence = { deviceId: device.deviceId, integrityToken: device.integrityToken, platform: 'android' };
  }
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...(await authedHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...evidence }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(String(data?.message || 'That did not work. Please try again.'));
  return data;
}

/** The facts about an account that decide whether a step can be claimed right now — the server's answer. */
export interface ReadinessFacts {
  steps: Array<{ step: RewardStep; claimed: boolean }>;
  emailVerified: boolean;
  phoneVerified: boolean;
  githubLinked: boolean;
  referred: boolean;
}

/**
 * PURE: the steps that are done but not yet paid — i.e. what a claim right now would actually pay for.
 *
 * On the web nothing is ready until the mobile is verified (the server holds everything until then), so
 * this returns nothing rather than sending a request that is certain to pay ₹0. In the app's own order,
 * because on Android each ready step is claimed separately.
 */
export function readyReferralSteps(facts: ReadinessFacts, surface: ReferralSurface): RewardStep[] {
  if (surface === 'web' && !facts.phoneVerified) return [];
  const proven: Record<RewardStep, boolean> = {
    'referral-code': facts.referred,
    email: facts.emailVerified,
    mobile: facts.phoneVerified,
    github: facts.githubLinked,
  };
  const unclaimed = new Set(facts.steps.filter((s) => !s.claimed).map((s) => s.step));
  return STEP_ORDER.filter((step) => unclaimed.has(step) && proven[step]);
}

/**
 * Claim every ready step, quietly. Returns the ₹ granted (0 when nothing was owed or anything failed).
 *
 * The web claim reconciles BOTH web steps in one request, so it is sent once; on Android each step is
 * its own device-checked claim. A failure never throws — this runs without the user asking, and a manual
 * Claim button stays on the rewards screen for anything it could not do.
 */
export async function claimReadySteps(userId: string, ready: RewardStep[], surface: ReferralSurface): Promise<number> {
  if (!userId || ready.length === 0) return 0;
  const path = `/api/referral/${encodeURIComponent(userId)}/claim`;
  const targets = surface === 'web' ? ready.slice(0, 1) : ready;
  let rupees = 0;
  for (const step of targets) {
    try {
      const data = await postReferral(path, { step }, surface);
      rupees += Number(data.rupees) || 0;
    } catch {
      // Nothing to show: an automatic claim that could not happen is not an error the user caused.
      // A device that cannot be checked will fail every step the same way, so stop asking.
      if (surface === 'android') break;
    }
  }
  return rupees;
}

/** The event every screen listens for after a reward lands, so each refreshes and one toast is shown. */
export const REFERRAL_GRANTED_EVENT = 'navbharat:referral-granted';
