// The user's own webhooks hear about a build or a deploy from the ONE place each outcome is decided
// (2026-10-11).
//
// 🔴 WHY THIS EXISTS: THE FEATURE WAS A PROMISE WITH NOTHING BEHIND IT. Settings → "Insights & Webhooks"
// let a user register URLs and said "Get a POST on BUILD_COMPLETE / FAILED / DEPLOY_COMPLETE / FAILED",
// and AppKnowledgeBase told every AI in the app the same thing. Nothing ever sent one: `fireWebhooks` had
// exactly one caller, the "Send test" button. A user who wired a build into Slack got the test message
// and then silence forever. Found by the Q-600 sweep — the page's own copy of the event list was a local
// nothing read, which is the shape that class leaves behind.
//
// So the events are fired here, from the two choke points that already decide the outcome:
//   • a BUILD — `announceBuildFinished`, which every AgentV3 build-end site calls instead of the push
//     notifier directly (the push and the webhook can no longer disagree about whether a build finished);
//   • a DEPLOY — `announceDeploy`, called by the deploy function every publish goes through (the Publish
//     button AND the AI's own `deploy` tool), and by the server-app publish, which has its own sequence.
// `tests/aWebhookHearsTheRealEvent.test.ts` fails if a build-end site calls the push notifier directly.
//
// Fire-and-forget: a webhook can never slow, fail or change a build or a publish.
//
// WHAT A WEBHOOK RECEIVES — deliberately small, because the URL is often a third party's (Slack, Discord):
// the event, whether it succeeded, when, and for a deploy the public link. Never a workspace id, a uid,
// an e-mail, a cost or an error text (an error can carry a vendor name or a path).

import { fireWebhooks, type WebhookEvent } from '../WebhookManager';
import { notifyBuildComplete } from './PushNotificationService';

type Fire = (uid: string, event: WebhookEvent, payload: Record<string, unknown>) => Promise<unknown>;

export interface AnnounceDeps {
  fire?: Fire;
  push?: (uid: string | null, ok: boolean) => Promise<void>;
  now?: () => Date;
}

/** The body a webhook receives for a finished build. PURE. */
export function buildEventPayload(ok: boolean, at: Date): Record<string, unknown> {
  return { ok, finishedAt: at.toISOString() };
}

/** The body a webhook receives for a deploy. PURE. Only an http(s) link travels. */
export function deployEventPayload(ok: boolean, at: Date, url?: string | null): Record<string, unknown> {
  const link = typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : '';
  return { ok, finishedAt: at.toISOString(), ...(ok && link ? { url: link } : {}) };
}

/**
 * What a server-app publish means to a webhook. PURE.
 *
 * Only an ATTEMPT that ended counts: live → complete, a started deploy that failed → failed. Two answers
 * are not deploys at all and stay silent — the plan's server-app limit (nothing was started) and "already
 * being deployed" (the RUNNING deploy will announce itself; a second event would double-report it).
 */
export function serverPublishOutcome(result: { live: boolean; body?: Record<string, unknown> }): 'complete' | 'failed' | null {
  if (result.live) return 'complete';
  const code = result.body && typeof result.body.code === 'string' ? result.body.code : '';
  if (code === 'deploy-in-progress' || code === 'server_app_limit') return null;
  return 'failed';
}

function safely(run: () => Promise<unknown>): void {
  try { void run().catch(() => { /* a webhook never affects the caller */ }); } catch { /* same */ }
}

/** A build finished: the phone push AND the user's webhooks. Never throws, never waits. */
export function announceBuildFinished(uid: string | null, ok: boolean, deps: AnnounceDeps = {}): void {
  safely(() => (deps.push ?? notifyBuildComplete)(uid, ok));
  if (!uid) return;
  const at = (deps.now ?? (() => new Date()))();
  safely(() => (deps.fire ?? fireWebhooks)(uid, ok ? 'BUILD_COMPLETE' : 'BUILD_FAILED', buildEventPayload(ok, at)));
}

/** A deploy finished (live or failed). Never throws, never waits. */
export function announceDeploy(uid: string | null, ok: boolean, url?: string | null, deps: AnnounceDeps = {}): void {
  if (!uid) return;
  const at = (deps.now ?? (() => new Date()))();
  safely(() => (deps.fire ?? fireWebhooks)(uid, ok ? 'DEPLOY_COMPLETE' : 'DEPLOY_FAILED', deployEventPayload(ok, at, url)));
}
