import type { BuildJob } from './AppMakerLab/jobs/BuildJobManager';
import { JobStatus } from './AppMakerLab/jobs/BuildJobManager';

/**
 * P-BRE.7 — Build & deploy notifications (webhook channel).
 *
 * When a build reaches a terminal state, fire a POST `{ jobId, status, previewUrl, ... }` to a
 * configured webhook URL so background/agent-triggered builds aren't silent. Config-gated +
 * best-effort: with no webhook URL set it is a clean no-op, and a webhook failure never affects
 * the build (it's fire-and-forget with a timeout). The payload builder + URL resolution are pure
 * and unit-tested.
 *
 * Scope (honest): only the WEBHOOK channel is implemented here — it needs no external service.
 * The SSE-toast and email channels in the spec are deferred: there is no standalone notifications
 * SSE stream yet, and email requires an external provider key (SendGrid/Firebase) that doesn't
 * exist for this project — per "real features only" they are not stubbed.
 */

export interface BuildNotification {
  event: 'build.completed' | 'build.failed';
  jobId: string;
  status: string;
  success: boolean;
  previewUrl: string | null;
  workspaceId: string | null;
  timestamp: string;
}

/** True only for terminal build states that warrant a notification. */
export function isTerminalStatus(status: JobStatus): boolean {
  return status === JobStatus.PREVIEW_READY || status === JobStatus.FAILED;
}

/** Build the webhook payload for a finished job. Pure. */
export function buildNotificationPayload(job: BuildJob, nowIso: string): BuildNotification {
  const success = job.status === JobStatus.PREVIEW_READY;
  return {
    event: success ? 'build.completed' : 'build.failed',
    jobId: job.id,
    status: String(job.status),
    success,
    previewUrl: job.previewUrl ?? null,
    workspaceId: job.workspaceId ?? null,
    timestamp: nowIso,
  };
}

/** Resolve the webhook URL: explicit arg wins, else the `BUILD_WEBHOOK_URL` env. Pure-ish. */
export function resolveWebhookUrl(explicit?: string): string | null {
  const url = (explicit || process.env.BUILD_WEBHOOK_URL || '').trim();
  return url || null;
}

/**
 * POST a notification to a webhook with a hard timeout. Best-effort: returns true on a 2xx,
 * false on any error/non-2xx, and NEVER throws (a flaky webhook must not break a build).
 */
export async function sendBuildWebhook(url: string, payload: BuildNotification, timeoutMs = 5000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire a build notification for a job if (a) the job is in a terminal state and (b) a webhook URL
 * is configured. No-op otherwise. Best-effort — never throws.
 */
export async function notifyBuildResult(job: BuildJob, opts: { webhookUrl?: string; nowIso?: string } = {}): Promise<void> {
  try {
    if (!isTerminalStatus(job.status)) return;
    const url = resolveWebhookUrl(opts.webhookUrl);
    if (!url) return;
    const payload = buildNotificationPayload(job, opts.nowIso ?? new Date().toISOString());
    const ok = await sendBuildWebhook(url, payload);
    if (!ok) console.warn(`[NOTIFY] build webhook POST did not succeed for job ${job.id}`);
  } catch (err) {
    console.error('[NOTIFY] notifyBuildResult failed (non-fatal):', err);
  }
}
