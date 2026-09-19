// IS THE REFERRAL GIFT ACTUALLY ABLE TO PAY? — the check that names the missing step instead of
// paying ₹0 in silence.
//
// 🔴 WHY THIS EXISTS (admin 2026-09-19: "maine jo merge kiya uske baad, 0 welcome credit ho rahe …
// referral code, mail verification, mobile verification, github verification wala bhi on karwao").
// The flat ₹500 welcome gift was retired on the admin's own ruling (#3030, 2026-09-17: "welcome bonus
// ₹500 band karna hai! sirf refer aur verification wale ₹400 dene hai"), so since that merge a new
// account receives nothing on arrival — BY DESIGN. The replacement, the four earned steps in
// `referralRewards.ts`, pays only through a device check that FAILS CLOSED (`deviceIntegrity.ts`):
// every one of `REFERRAL_REWARDS`, `GOOGLE_PLAY_SA_JSON`, `GOOGLE_PLAY_PACKAGE_NAME`, the Play
// Integrity API, the service account's access to it, and a Play release carrying
// `DeviceIntegrityPlugin` must be right, and a wrong one produces the SAME visible outcome as a
// missing one: ₹0, with nothing failing anywhere. PROGRESS.md's switch-on guide (2026-09-18) ends
// with "how to verify it really works: create an account on a phone and see whether ₹100 arrives" —
// a diagnostic that costs a Play review cycle per attempt and names nothing when it fails.
//
// This is the same answer `hostingPreflight.ts` gave the same problem: ask Google from the SAME code,
// with the SAME credential and the SAME package the real claim will use, and turn each refusal into
// the exact next action. Its three honesty rules apply unchanged — a check that could not run is
// `skipped`, never ok; a 403 is two different problems and is parsed, not guessed; an unrecognised
// answer is `unknown`, not `failed`.
//
// 🔒 WHAT THIS DELIBERATELY DOES NOT CLAIM. Two links in the chain live where no server can see:
// whether the `PLAY_INTEGRITY_CLOUD_PROJECT` repo secret was set when the live `.aab` was BUILT, and
// whether Play → Data safety was updated. They are listed under `manual`, in words, rather than
// reported as a state that would have been invented.
//
// PURE classification + one thin request. No money moves here; the probe sends a token that cannot
// be decoded, so Google's answer can only ever be "refused" — the QUESTION is which refusal.

import { referralRewardsEnabled } from './referralRewards';
import { googleAccessToken, googleServiceAccountEmail, PLAY_INTEGRITY_SCOPE } from './storeVerify';
import { ANDROID_PACKAGE_NAME } from './assetLinks';
import {
  isApiDisabled, skipped, preflightVerdict, nextAction,
  type PreflightCheck, type PreflightVerdict,
} from '../AgentV3/hostingPreflight';

export const PLAY_INTEGRITY_API = 'https://playintegrity.googleapis.com/v1';

/**
 * The first Play release that carries `DeviceIntegrityPlugin`.
 *
 * `android-aab.yml` stamps `versionCode = run number`; run **#117** built commit `749cf054`, the
 * #2953 merge that added the plugin (2026-09-15). `ANDROID_LATEST_VERSION_CODE` is what the admin
 * sets after each Play upload, so comparing the two is the one server-readable fact about whether
 * the app people have installed can attest at all. Release 91 — the first production release — cannot.
 */
export const FIRST_RELEASE_WITH_DEVICE_PLUGIN = 117;

/** The token the probe sends. Google cannot decode it, which is the point: only the REFUSAL is read. */
export const PROBE_TOKEN = 'navbharatai-setup-check';

export interface ReferralPreflightReport {
  verdict: PreflightVerdict;
  checks: PreflightCheck[];
  nextAction: string;
  /** The links no server can observe, stated as work rather than reported as a state. */
  manual: string[];
}

/** What a wrong `ANDROID_LATEST_VERSION_CODE` looks like versus a right one. PURE. */
export function classifyRelease(raw: unknown): PreflightCheck {
  const id = 'release';
  const label = 'Play release carries the device check';
  const s = String(raw ?? '').trim();
  if (!s) {
    return {
      id, label, state: 'unknown',
      detail: 'ANDROID_LATEST_VERSION_CODE is not set, so the live release cannot be judged from here.',
      remedy: `After the next Play upload is live, set ANDROID_LATEST_VERSION_CODE in Cloud Run to that run number (${FIRST_RELEASE_WITH_DEVICE_PLUGIN} or later carries the device check).`,
    };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    return {
      id, label, state: 'unknown',
      detail: `ANDROID_LATEST_VERSION_CODE is "${s}", which is not a run number.`,
      remedy: 'Set ANDROID_LATEST_VERSION_CODE to the run number of the release that is live on Play.',
    };
  }
  if (n < FIRST_RELEASE_WITH_DEVICE_PLUGIN) {
    return {
      id, label, state: 'failed',
      detail: `The live release is ${n}; the device check first shipped in build ${FIRST_RELEASE_WITH_DEVICE_PLUGIN}. Nobody's installed app can attest yet.`,
      remedy: 'Build a fresh .aab from main (with the PLAY_INTEGRITY_CLOUD_PROJECT repo secret set), roll it out on Play, then set ANDROID_LATEST_VERSION_CODE to its run number.',
    };
  }
  return {
    id, label, state: 'ok',
    detail: `Release ${n} carries the device check — provided the PLAY_INTEGRITY_CLOUD_PROJECT repo secret was set when it was built, which cannot be seen from here.`,
    remedy: '',
  };
}

/**
 * Read Google's answer to a token it cannot decode. PURE — the whole diagnosis, testable without Google.
 *
 * A 400 is the GOOD answer: the API is enabled, the credential is accepted, the package is known, and
 * the only thing wrong is our deliberately unreadable token. Everything else names what to fix.
 */
export function classifyIntegrityProbe(status: number, body: unknown): PreflightCheck {
  const id = 'api';
  const label = 'Play Integrity API answers for this app';
  if (status === 400) {
    return { id, label, state: 'ok', detail: 'Play Integrity answered — it refused the test token, as intended.', remedy: '' };
  }
  if (isApiDisabled(status, body)) {
    return {
      id, label, state: 'failed',
      detail: 'The Play Integrity API is not enabled in the project that owns the service account.',
      remedy: 'Enable the Play Integrity API in that Google Cloud project (APIs & Services → Library → "Play Integrity API" — not Safe Browsing, not Play Developer).',
    };
  }
  if (status === 403) {
    return {
      id, label, state: 'failed',
      detail: 'Google accepted the credential but refused the call — the service account may not decode tokens for this app.',
      remedy: 'In Play Console → Release → App integrity, link the app to the Google Cloud project that owns this service account, and grant the account access to the Play Integrity API there; then re-run.',
    };
  }
  if (status === 404) {
    return {
      id, label, state: 'failed',
      detail: 'Play Integrity does not know this package name.',
      remedy: `Check GOOGLE_PLAY_PACKAGE_NAME is exactly the Play listing's package (${ANDROID_PACKAGE_NAME}) and that the app is linked to a Cloud project in Play Console → App integrity.`,
    };
  }
  if (status === 401) {
    return {
      id, label, state: 'failed',
      detail: 'The request was not authenticated.',
      remedy: 'The access token was refused. Re-paste GOOGLE_PLAY_SA_JSON from a freshly downloaded key and re-run.',
    };
  }
  return {
    id, label, state: 'unknown',
    detail: `Google answered ${status}, which this check does not recognise.`,
    remedy: 'Re-run the check. If it persists, read the exact response in the server logs.',
  };
}

const REMOTE_CHECKS: ReadonlyArray<readonly [id: string, label: string]> = [
  ['credential', 'Service account can mint a Play Integrity token'],
  ['api', 'Play Integrity API answers for this app'],
];

/** The two links no server can observe. Words, not states — see the header. */
export const MANUAL_STEPS: readonly string[] = [
  'The PLAY_INTEGRITY_CLOUD_PROJECT GitHub repo secret (the Cloud project NUMBER, digits only) must be set BEFORE the .aab is built — a bundle built without it reports "not configured" on every phone, and no server check can see which bundle was built with it.',
  'Play Console → App content → Data safety must declare the device identifier before a build with the device check is rolled out (Privacy Policy §3.2 already discloses it).',
  'Website users earn ₹0 by design ("websites par kuch bhi nahi dena") — every step is claimed inside the Android app.',
];

/**
 * Run every check against the real Google, in the order the switch-on guide gives them — so
 * `nextAction` (the first remedy) is naturally the earliest missing step, and `REFERRAL_REWARDS`
 * comes LAST: with it on and any link above it broken, a new user gets the flat gift retired AND ₹0
 * from the ladder.
 *
 * A failure never stops the run — the admin sees every missing step in one pass. A check whose
 * precondition failed is `skipped`, never ok.
 */
export async function runReferralPreflight(opts: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Test seam. Defaults to minting a real Play-Integrity-scoped token from GOOGLE_PLAY_SA_JSON. */
  mintToken?: (env: NodeJS.ProcessEnv) => Promise<string | null>;
} = {}): Promise<ReferralPreflightReport> {
  const env = opts.env ?? process.env;
  const checks: PreflightCheck[] = [];

  // 1. The package — the app the token will be decoded for.
  const pkg = (env.GOOGLE_PLAY_PACKAGE_NAME || '').trim();
  if (!pkg) {
    checks.push({
      id: 'package', label: 'Package name configured', state: 'failed',
      detail: 'GOOGLE_PLAY_PACKAGE_NAME is not set.',
      remedy: `Set GOOGLE_PLAY_PACKAGE_NAME=${ANDROID_PACKAGE_NAME} in Cloud Run.`,
    });
  } else if (pkg !== ANDROID_PACKAGE_NAME) {
    checks.push({
      id: 'package', label: 'Package name configured', state: 'failed',
      detail: `GOOGLE_PLAY_PACKAGE_NAME is "${pkg}", but the Android app is ${ANDROID_PACKAGE_NAME}.`,
      remedy: `Set GOOGLE_PLAY_PACKAGE_NAME=${ANDROID_PACKAGE_NAME} in Cloud Run.`,
    });
  } else {
    checks.push({ id: 'package', label: 'Package name configured', state: 'ok', detail: pkg, remedy: '' });
  }

  // 2. The service account — present, and readable as one.
  const saRaw = (env.GOOGLE_PLAY_SA_JSON || '').trim();
  const saEmail = googleServiceAccountEmail(env);
  if (!saRaw) {
    checks.push({
      id: 'serviceAccount', label: 'Service account configured', state: 'failed',
      detail: 'GOOGLE_PLAY_SA_JSON is not set.',
      remedy: 'Set GOOGLE_PLAY_SA_JSON in Cloud Run to the WHOLE service-account JSON file, as one string.',
    });
  } else if (!saEmail) {
    checks.push({
      id: 'serviceAccount', label: 'Service account configured', state: 'failed',
      detail: 'GOOGLE_PLAY_SA_JSON is set but does not parse as a service-account key (it needs client_email and private_key).',
      remedy: 'Re-paste the whole JSON file into GOOGLE_PLAY_SA_JSON — a truncated or hand-edited value reads as no account at all.',
    });
  } else {
    checks.push({ id: 'serviceAccount', label: 'Service account configured', state: 'ok', detail: saEmail, remedy: '' });
  }

  const configured = Boolean(pkg) && pkg === ANDROID_PACKAGE_NAME && Boolean(saEmail);

  /** Mark every remote check that never got to run, then finish. Skips ids already recorded. */
  const finish = (why: string | null): ReferralPreflightReport => {
    if (why) {
      for (const [id, label] of REMOTE_CHECKS) {
        if (!checks.some((c) => c.id === id)) checks.push(skipped(id, label, why));
      }
    }
    checks.push(classifyRelease(env.ANDROID_LATEST_VERSION_CODE));
    checks.push(referralRewardsEnabled(env)
      ? { id: 'flag', label: 'REFERRAL_REWARDS is on', state: 'ok', detail: '', remedy: '' }
      : {
        id: 'flag', label: 'REFERRAL_REWARDS is on', state: 'failed',
        detail: 'REFERRAL_REWARDS is not set. Since 2026-09-17 the flat welcome gift is retired as well, so a new user currently receives ₹0.',
        remedy: 'Set REFERRAL_REWARDS=on in Cloud Run — LAST, once every check above is green.',
      });
    return { verdict: preflightVerdict(checks), checks, nextAction: nextAction(checks), manual: [...MANUAL_STEPS] };
  };

  if (!configured) return finish('Not checked — the package name and service account must be right first.');

  // 3. The credential — a token minted for the Play Integrity scope, from that account.
  const mint = opts.mintToken
    ?? ((e: NodeJS.ProcessEnv) => googleAccessToken(Math.floor(Date.now() / 1000), PLAY_INTEGRITY_SCOPE, e));
  const access = await mint(env).catch(() => null);
  if (!access) {
    checks.push({
      id: 'credential', label: 'Service account can mint a Play Integrity token', state: 'failed',
      detail: 'Google refused the service-account key.',
      remedy: 'Check the key is not deleted or disabled (IAM → Service accounts → Keys), then re-paste the JSON into GOOGLE_PLAY_SA_JSON.',
    });
    return finish('Not checked — no Google credential.');
  }
  checks.push({ id: 'credential', label: 'Service account can mint a Play Integrity token', state: 'ok', detail: '', remedy: '' });

  // 4. The API, for this package, with that credential — the SAME call a real claim makes.
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const r = await doFetch(`${PLAY_INTEGRITY_API}/${encodeURIComponent(pkg)}:decodeIntegrityToken`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrityToken: PROBE_TOKEN }),
    });
    checks.push(classifyIntegrityProbe(r.status, await r.json().catch(() => null)));
  } catch (e) {
    checks.push({
      id: 'api', label: 'Play Integrity API answers for this app', state: 'unknown',
      detail: `Google could not be reached: ${e instanceof Error ? e.message : String(e)}`,
      remedy: 'Re-run the check in a minute.',
    });
  }
  return finish(null);
}
