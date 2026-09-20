// CAN A NOTIFICATION ACTUALLY REACH A PHONE? — the check that names the missing link instead of
// delivering nothing in silence.
//
// 🔴 WHY THIS EXISTS (admin 2026-09-20: "jaise app notifications ate hai hamare mobile me woh
// notifications abhi navbharatai me nahi aa rahe hai — isko on karwane ke liye aur kya karna
// chahiye"). Push notifications are not missing from this codebase: the receive side
// (`src/lib/pushNotifications.ts`), the token registry (`DeviceTokenStore`), the registration routes
// (`routes/push.ts`) and the send side (`PushNotificationService`) have all existed since
// 2026-08-25 and are wired end to end. The feature nevertheless delivers nothing, and every one of
// the four possible reasons produces the SAME visible outcome — no notification, no error, nothing
// logged anywhere a person looks:
//
//   1. the app installed on the phone predates the plugin, so it never asks for permission and never
//      registers a token (see FIRST_RELEASE_WITH_PUSH_PLUGIN — this is the likeliest one);
//   2. nobody has a token registered, for that reason or because permission was declined;
//   3. the Firebase Cloud Messaging API is not enabled in the Google Cloud project;
//   4. the Cloud Run runtime service account may not send messages.
//
// `sendPushToUser` is deliberately best-effort and silent — a push failure must never fail a build —
// so it swallows 3 and 4 by design. That is right for the build path and is exactly why a separate,
// loud diagnostic has to exist.
//
// This is the same answer `hostingPreflight.ts` and `referralPreflight.ts` gave the same problem, and
// it reuses their vocabulary rather than inventing a second one. Their three honesty rules apply
// unchanged: a check that could not run is `skipped`, never ok; a refusal is PARSED, never guessed;
// an unrecognised answer is `unknown`, not `failed`.
//
// 🔒 THE PROBE ASKS THE REAL QUESTION WITH THE REAL CREDENTIAL. It calls the same
// `admin.messaging().send()` a real notification calls, through the same Application Default
// Credentials, against the same project — the only difference is a device token Google cannot decode.
// So the answer can only ever be a refusal, and the diagnosis is WHICH refusal: "invalid argument"
// means the entire chain works and only our fake token was wrong, which is the GOOD answer.
//
// PURE classification plus one thin request. Nothing here sends a real notification to anybody.

import * as admin from 'firebase-admin';
import { deviceTokenStore } from './DeviceTokenStore';
import {
  skipped, preflightVerdict, nextAction,
  type PreflightCheck, type PreflightVerdict,
} from '../AgentV3/hostingPreflight';

/**
 * The first Play release that carries `@capacitor-firebase/messaging`.
 *
 * `android-aab.yml` stamps `versionCode = run number`. Run **#96** built commit `7065c7dd`
 * (2026-08-26), the first bundle whose tree contains the plugin; run **#95** (`ce537eef`) and every
 * run before it — including **#91**, the first production release and the value
 * `ANDROID_LATEST_VERSION_CODE` has held since 2026-08-25 — do NOT. Verified by asking git whether
 * the commit that introduced the plugin is an ancestor of each run's head SHA, not by reading dates:
 * the plugin merged at 21:18 on 2026-08-25 and run #91 was built at 12:10 the same day, so the dates
 * alone would have said the opposite of the truth.
 *
 * An app built without the plugin cannot ask for notification permission, cannot obtain an FCM token
 * and never calls /api/push. Nothing on the server can reach it, and nothing on the server can tell.
 */
export const FIRST_RELEASE_WITH_PUSH_PLUGIN = 96;

/** The token the probe sends. Google cannot decode it, which is the point: only the REFUSAL is read. */
export const PROBE_TOKEN = 'navbharatai-setup-check';

export interface PushPreflightReport {
  verdict: PreflightVerdict;
  checks: PreflightCheck[];
  nextAction: string;
  /** The links no server can observe, stated as work rather than reported as a state. */
  manual: string[];
}

/** What a wrong `ANDROID_LATEST_VERSION_CODE` looks like versus a right one. PURE. */
export function classifyRelease(raw: unknown): PreflightCheck {
  const id = 'release';
  const label = 'The installed app can receive notifications';
  const s = String(raw ?? '').trim();
  if (!s) {
    return {
      id, label, state: 'unknown',
      detail: 'ANDROID_LATEST_VERSION_CODE is not set, so the live release cannot be judged from here.',
      remedy: `After the next Play upload is live, set ANDROID_LATEST_VERSION_CODE in Cloud Run to that run number (${FIRST_RELEASE_WITH_PUSH_PLUGIN} or later carries push).`,
    };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return {
      id, label, state: 'unknown',
      detail: `ANDROID_LATEST_VERSION_CODE is "${s}", which is not a run number.`,
      remedy: 'Set ANDROID_LATEST_VERSION_CODE to the run number of the release that is live on Play.',
    };
  }
  if (n < FIRST_RELEASE_WITH_PUSH_PLUGIN) {
    return {
      id, label, state: 'failed',
      detail: `The live release is ${n}; push notifications first shipped in build ${FIRST_RELEASE_WITH_PUSH_PLUGIN}. The app people have installed contains no notification code at all, so nothing we send can reach it.`,
      remedy: 'Build a fresh .aab from main, roll it out on Play, and set ANDROID_LATEST_VERSION_CODE to its run number once it is downloadable.',
    };
  }
  return {
    id, label, state: 'ok',
    detail: `The live release is ${n}, which carries push notifications.`,
    remedy: '',
  };
}

/** Whether any device could be reached at all, and on what. PURE. */
export function classifyDevices(rows: ReadonlyArray<{ platform?: string }>): PreflightCheck {
  const id = 'devices';
  const label = 'Devices are registered to receive';
  const counts = { android: 0, ios: 0, web: 0, other: 0 };
  for (const r of rows) {
    const p = String(r?.platform ?? '');
    if (p === 'android' || p === 'ios' || p === 'web') counts[p] += 1;
    else counts.other += 1;
  }
  const total = rows.length;
  if (total === 0) {
    return {
      id, label, state: 'failed',
      detail: 'No device has ever registered for notifications. Until one does, a working send path delivers to nobody.',
      remedy: 'Sign in on a phone running a release that carries push and accept the notification prompt, then run this check again.',
    };
  }
  const parts = [
    counts.android ? `${counts.android} Android` : '',
    counts.ios ? `${counts.ios} iOS` : '',
    counts.web ? `${counts.web} web` : '',
    counts.other ? `${counts.other} unknown` : '',
  ].filter(Boolean);
  return { id, label, state: 'ok', detail: `${total} registered device${total === 1 ? '' : 's'} — ${parts.join(', ')}.`, remedy: '' };
}

/**
 * What Firebase's refusal of the probe actually means. PURE.
 *
 * ⚠️ `invalid-argument` IS THE GOOD ANSWER and must never be reported as a failure: it means Firebase
 * authenticated us, accepted the project, reached Cloud Messaging, and refused only the deliberately
 * undecodable token. Every other refusal is a real setup gap, and they need different fixes.
 */
export function classifyFcmError(err: unknown): PreflightCheck {
  const id = 'fcm';
  const label = 'Firebase Cloud Messaging accepts our send';
  const e = err && typeof err === 'object' ? err as Record<string, any> : {};
  const code = String(e.code ?? e.errorInfo?.code ?? '').toLowerCase();
  const message = String(e.message ?? e.errorInfo?.message ?? '');
  const lower = message.toLowerCase();

  if (code.includes('invalid-argument') || code.includes('invalid-registration-token')
    || code.includes('registration-token-not-registered') || lower.includes('not a valid fcm registration token')) {
    return {
      id, label, state: 'ok',
      detail: 'Firebase accepted the request and refused only the test token, which is what a working send path does.',
      remedy: '',
    };
  }
  if (lower.includes('has not been used in project') || lower.includes('service_disabled')
    || lower.includes('is disabled') || lower.includes('api has not been enabled')) {
    return {
      id, label, state: 'failed',
      detail: 'The Firebase Cloud Messaging API is not enabled in the Google Cloud project, so every send is refused before it reaches a phone.',
      remedy: 'Google Cloud console -> APIs & Services -> Library -> enable "Firebase Cloud Messaging API" in gen-lang-client-0866594388.',
    };
  }
  if (code.includes('authentication-error') || code.includes('invalid-credential')
    || code.includes('third-party-auth-error') || lower.includes('permission_denied')
    || lower.includes('permission denied') || lower.includes('caller does not have permission')) {
    return {
      id, label, state: 'failed',
      detail: 'Firebase refused our credential: the service account this server runs as may not send Cloud Messaging messages.',
      remedy: 'Grant the Cloud Run runtime service account the "Firebase Cloud Messaging API Admin" role in gen-lang-client-0866594388.',
    };
  }
  if (code.includes('mismatched-credential')) {
    return {
      id, label, state: 'failed',
      detail: 'The credential this server uses belongs to a different Firebase project from the one the app is registered against.',
      remedy: 'Make sure the server and android/app/google-services.json both name gen-lang-client-0866594388.',
    };
  }
  return {
    id, label, state: 'unknown',
    detail: `Firebase answered something this check does not recognise${message ? `: ${message.slice(0, 200)}` : ''}.`,
    remedy: 'Read the server log for the full Firebase error before changing anything.',
  };
}

/**
 * Ask Firebase the real question with the real credential.
 *
 * A send that SUCCEEDS would mean Google accepted a token that cannot exist, so it is reported as
 * `unknown` rather than quietly counted as a pass — a check that cannot fail proves nothing, which is
 * the lesson this repo already paid for once on the E2B rate derivation.
 */
async function probeFcm(): Promise<PreflightCheck> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return skipped('fcm', 'Firebase Cloud Messaging accepts our send', 'Not probed in tests.');
  }
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
  } catch {
    return skipped('fcm', 'Firebase Cloud Messaging accepts our send', 'The Firebase admin SDK could not start on this server, so the send path could not be asked.');
  }
  try {
    await admin.messaging().send({ token: PROBE_TOKEN, notification: { title: 'setup check', body: 'setup check' } });
    return {
      id: 'fcm',
      label: 'Firebase Cloud Messaging accepts our send',
      state: 'unknown',
      detail: 'Firebase accepted a device token that cannot be real, so this check could not learn anything from the answer.',
      remedy: 'Send a real test notification to your own device instead.',
    };
  } catch (err) {
    return classifyFcmError(err);
  }
}

/**
 * The links that live where no server can see them.
 *
 * Listed in words rather than reported as a state, because inventing either would be worse than
 * saying nothing: whether a `.aab` carrying the plugin is actually LIVE on Play is a Play Console
 * fact, and iOS push needs a file and an APNs key that only exist in the Apple and Firebase consoles.
 */
export const MANUAL_STEPS: readonly string[] = [
  'Android: a build carrying the notification plugin must be live on Play. Only builds 96 and later have it; build 91 does not.',
  'iOS: ios/App/App/GoogleService-Info.plist is not in this repository and an APNs key has never been uploaded to Firebase, so iPhone notifications cannot work yet — this is Android-only today.',
  'Each person must accept the notification prompt once on their own phone; a decline is final until they change it in Android settings.',
];

/** Run every check. Never throws — a diagnostic that fails is a diagnostic nobody can use. */
export async function runPushPreflight(env: NodeJS.ProcessEnv = process.env): Promise<PushPreflightReport> {
  const checks: PreflightCheck[] = [];
  checks.push(classifyRelease(env.ANDROID_LATEST_VERSION_CODE));
  try {
    const { rows } = await deviceTokenStore.listAllTokens();
    checks.push(classifyDevices(rows));
  } catch {
    checks.push(skipped('devices', 'Devices are registered to receive', 'The device registry could not be read.'));
  }
  checks.push(await probeFcm());
  return {
    verdict: preflightVerdict(checks),
    checks,
    nextAction: nextAction(checks),
    manual: [...MANUAL_STEPS],
  };
}
