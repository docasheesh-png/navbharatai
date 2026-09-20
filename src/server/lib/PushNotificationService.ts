// Push notifications — the actual SEND side (admin request 2026-07-26). Uses firebase-admin's Cloud
// Messaging (the SAME Firebase project — gen-lang-client-0866594388 — the app already authenticates
// against; no new infrastructure). Sends to every device token registered for a user via
// DeviceTokenStore, and prunes any token FCM reports as invalid/unregistered so the store never
// accumulates dead devices. Best-effort throughout: a push failure must NEVER fail or slow down the
// build/spend flow that triggered it — every public function is fire-and-forget safe.
//
// WHITE-LABEL LAW (CLAUDE.md): notification title/body are always branded "NavBharatAI" — never a
// provider name (this module has no provider name to leak in the first place; it's our own Firebase
// project's own messaging, not a third-party AI vendor).

import * as admin from 'firebase-admin';
import { deviceTokenStore } from './DeviceTokenStore';

export interface PushPayload {
  title: string;
  body: string;
  /** Optional deep-link data the client can use to navigate on tap (e.g. { workspaceId }). Values must
   *  be strings — FCM's `data` payload only carries string key/value pairs. */
  data?: Record<string, string>;
}

/** Lazily resolve admin.messaging() — never throws; returns null if the admin app can't init. */
function getMessaging(): admin.messaging.Messaging | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return admin.messaging();
  } catch {
    return null;
  }
}

/** Minimal shape of a sendEachForMulticast response entry we depend on — kept narrow so this stays
 *  testable without a real firebase-admin SendResponse. */
export interface SendResponseLike {
  success: boolean;
  error?: { code?: string };
}

/**
 * PURE: given the tokens a multicast send targeted and FCM's per-token responses (same order), return
 * which tokens FCM reported as permanently dead (uninstalled app, expired token). Unit-tested — the
 * live sendPushToUser wraps this with real I/O.
 */
export function deadTokensFrom(tokens: string[], responses: SendResponseLike[]): string[] {
  const dead: string[] = [];
  responses.forEach((r, i) => {
    if (!r.success && tokens[i]) {
      const code = r.error?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        dead.push(tokens[i]);
      }
    }
  });
  return dead;
}

/**
 * What one send actually did.
 *
 * 🔴 WHY THIS EXISTS (2026-09-20). This function used to return `void`, and that was not merely
 * uninformative — it is the reason "notifications nahi aa rahe" could not be diagnosed at all. Every
 * way a send can fail (no admin SDK, no registered device, a disabled Cloud Messaging API, a service
 * account without permission) produced the SAME `undefined`, swallowed by the same `catch`, with
 * nothing logged. The silence is right for the CALLERS — a push must never fail a build — but the
 * information was being thrown away rather than not existing.
 *
 * Every existing caller ignores this value, so nothing about their behaviour changed. It exists for
 * the admin's test-send button, which needs to say what happened.
 */
export interface PushSendResult {
  /** How many registered devices the send targeted. Zero is the commonest real failure. */
  tokens: number;
  sent: number;
  failed: number;
  /** Tokens FCM reported as permanently dead and which were removed from the registry. */
  pruned: number;
  /** Why nothing was sent, when nothing was. Empty on a send that reached FCM. */
  reason: '' | 'no-user' | 'no-messaging' | 'no-devices' | 'error';
  /** The raw failure, for the admin's screen only — never shown to an end user. */
  error?: string;
}

const NOTHING = (reason: PushSendResult['reason']): PushSendResult => ({ tokens: 0, sent: 0, failed: 0, pruned: 0, reason });

/**
 * Send a push notification to every device registered for a user. Best-effort and silent by design
 * (the caller is always a fire-and-forget hook off a real event — a build finishing, a balance going
 * low — never something the request path should wait on or fail because of).
 *
 * It still never throws. It now RETURNS what happened, which the fire-and-forget callers ignore.
 */
export async function sendPushToUser(uid: string | null, payload: PushPayload): Promise<PushSendResult> {
  if (!uid) return NOTHING('no-user');
  try {
    const messaging = getMessaging();
    if (!messaging) return NOTHING('no-messaging');
    const tokens = await deviceTokenStore.listTokensForUser(uid);
    if (!tokens.length) return NOTHING('no-devices');

    const result = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    // Prune tokens FCM says are dead (uninstalled app, expired token, etc.) so future sends don't
    // keep paying the round-trip for a device that will never receive anything again.
    const dead = deadTokensFrom(tokens.map((t) => t.token), result.responses);
    if (dead.length) await deviceTokenStore.removeTokens(uid, dead);
    return {
      tokens: tokens.length,
      sent: result.successCount,
      failed: result.failureCount,
      pruned: dead.length,
      reason: '',
    };
  } catch (err) {
    /* best-effort — a push failure never propagates to the caller */
    return { ...NOTHING('error'), error: err instanceof Error ? err.message : String(err) };
  }
}

/** "Your build is ready" / "your build failed" — fired once a real AgentV3 build finishes. */
export async function notifyBuildComplete(uid: string | null, ok: boolean, appName?: string): Promise<void> {
  const name = appName?.trim() || 'Your app';
  await sendPushToUser(uid, {
    title: ok ? 'Build ready ✅' : 'Build needs attention',
    body: ok ? `${name} finished building — open NavBharatAI to see it.` : `${name} hit an issue while building — open NavBharatAI for details.`,
    data: { kind: 'build_complete', ok: String(ok) },
  });
}

/** Wallet balance alert — fired from the paid-tier affordability gate (economy or block branch). */
export async function notifyLowBalance(uid: string | null, blocked: boolean): Promise<void> {
  await sendPushToUser(uid, {
    title: blocked ? 'Wallet balance is ₹0' : 'Wallet balance is low',
    body: blocked
      ? 'Add credits in NavBharatAI to keep building.'
      : 'Your balance is running low — add credits to avoid interruption.',
    data: { kind: 'low_balance', blocked: String(blocked) },
  });
}
