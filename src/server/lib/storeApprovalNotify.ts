// App Mart / Nav App Store — congratulate the creator when their app is APPROVED (admin request,
// 2026-09-16: "jab admin kisi user ki app ko appmart ke liye aproove kare to use user ke pas
// notification jana chahiye, congratulation ka. email bhi bhej sakte hai kuch acha sa").
//
// ONE shared module for BOTH store surfaces — the APK store's 'approved' decision and the web-app
// store's 'listed' decision are the same real-world event ("your app is now live and anyone can find
// it"), so they get the same celebration rather than two hand-written copies that drift apart.
//
// Same shape as siteUptimeSweep.ts's owner-notification path: an in-app bell entry via
// AdminNotificationStore, plus a best-effort email via alertEmail.ts if one is configured and the
// account's email is verified. Reused rather than reinvented — this is the platform's one existing
// answer to "how do we reach a user outside the app", not a second one.

import * as admin from 'firebase-admin';
import { saveNotification } from './AdminNotificationStore';
import { resolveEmailConfig, sendAlertEmail } from './alertEmail';

export type StoreAppKind = 'apk' | 'web';

const storeName = (kind: StoreAppKind): string => (kind === 'apk' ? 'Nav App Store' : 'App Mart');

/** The in-app bell message. Pure. */
export function approvalBellMessage(appName: string, kind: StoreAppKind): string {
  return `🎉 Congratulations! "${appName}" has been approved and is now live on ${storeName(kind)} — anyone can find and open it.`;
}

/**
 * The email subject.
 *
 * A one-time code belongs only in a body (see alertEmail.ts's own note on why `subject` must be
 * passed explicitly for anything that is not a Monitor alert) — this is not one, but the same
 * discipline applies: this is USER-facing mail, so its subject is written for a person, not derived
 * from the internal alert format. Pure.
 */
export function approvalEmailSubject(appName: string): string {
  return `🎉 "${appName}" is now live on App Mart`;
}

/** The email body. Pure. */
export function approvalEmailBody(appName: string, kind: StoreAppKind): string {
  const where = storeName(kind);
  const action = kind === 'apk' ? 'installed on their phone' : 'opened and run right in their browser';
  return `Great news — your app "${appName}" has passed review and is now LIVE on ${where}.\n\n`
    + `Anyone who finds it in the store can have it ${action}.\n\n`
    + `Thank you for building with NavBharatAI — keep shipping!\n\n— NavBharatAI`;
}

/** The submitting account's verified email, or null when there isn't one worth mailing. */
async function ownerEmail(uid: string): Promise<string | null> {
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    const u = await admin.auth().getUser(uid);
    return u.email && u.emailVerified !== false ? u.email : null;
  } catch {
    return null;
  }
}

export interface NotifyApprovalDeps {
  notify: (uid: string, message: string) => Promise<unknown>;
  resolveEmail: (uid: string) => Promise<string | null>;
  email: (to: string, subject: string, body: string) => Promise<boolean>;
}

export const realNotifyApprovalDeps: NotifyApprovalDeps = {
  notify: (uid, message) => saveNotification({ message, target: { type: 'user', userId: uid }, createdBy: 'system' }),
  resolveEmail: (uid) => ownerEmail(uid),
  email: async (to, subject, body) => {
    const cfg = resolveEmailConfig();
    if (!cfg.configured) return false;
    const r = await sendAlertEmail({ ...cfg, to: [to] }, body, {
      subject,
      footer: '— NavBharatAI\nOpen the app → Nav App Store to see it live.',
    }).catch(() => ({ sent: false }));
    return r.sent === true;
  },
};

/**
 * Congratulate the creator: an in-app bell notification, plus a best-effort email when one is
 * configured and the account's email is verified.
 *
 * Never throws — the whole point is celebrating a successful admin action, so a notification/email
 * failure here must never turn that success into an error response. Callers should fire this AFTER
 * responding to the admin (see the "side effects after the response" discipline in
 * routes/navStore.ts's web/publish bake), so a slow email provider never holds up the review screen.
 */
export async function notifyStoreApproval(
  uid: string, appName: string, kind: StoreAppKind, deps: Partial<NotifyApprovalDeps> = {},
): Promise<void> {
  const d: NotifyApprovalDeps = { ...realNotifyApprovalDeps, ...deps };
  const name = (appName || '').trim() || 'Your app';
  try {
    await d.notify(uid, approvalBellMessage(name, kind)).catch(() => null);
    const to = await d.resolveEmail(uid).catch(() => null);
    if (to) {
      await d.email(to, approvalEmailSubject(name), approvalEmailBody(name, kind)).catch(() => false);
    }
  } catch { /* congratulating a creator must never break the approval it is celebrating */ }
}
