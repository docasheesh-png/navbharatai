import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildNotificationPayload, resolveWebhookUrl, isTerminalStatus,
  sendBuildWebhook, notifyBuildResult,
} from '../src/server/NotificationManager';
import { JobStatus, type BuildJob } from '../src/server/AppMakerLab/jobs/BuildJobManager';

function job(over: Partial<BuildJob>): BuildJob {
  return {
    id: 'job-1', prompt: 'p', status: JobStatus.PREVIEW_READY, progress: 100, logs: [],
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:05Z'),
    ...over,
  } as BuildJob;
}

afterEach(() => { vi.restoreAllMocks(); delete process.env.BUILD_WEBHOOK_URL; });

describe('NotificationManager — isTerminalStatus', () => {
  it('only PREVIEW_READY + FAILED are terminal', () => {
    expect(isTerminalStatus(JobStatus.PREVIEW_READY)).toBe(true);
    expect(isTerminalStatus(JobStatus.FAILED)).toBe(true);
    expect(isTerminalStatus(JobStatus.BUILDING)).toBe(false);
    expect(isTerminalStatus(JobStatus.QUEUED)).toBe(false);
  });
});

describe('NotificationManager — buildNotificationPayload', () => {
  it('maps a successful build', () => {
    const p = buildNotificationPayload(job({ status: JobStatus.PREVIEW_READY, previewUrl: 'https://x', workspaceId: 'w1' }), '2026-01-01T00:00:06Z');
    expect(p).toEqual({
      event: 'build.completed', jobId: 'job-1', status: 'PREVIEW_READY', success: true,
      previewUrl: 'https://x', workspaceId: 'w1', timestamp: '2026-01-01T00:00:06Z',
    });
  });
  it('maps a failed build with null preview', () => {
    const p = buildNotificationPayload(job({ status: JobStatus.FAILED }), '2026-01-01T00:00:06Z');
    expect(p.event).toBe('build.failed');
    expect(p.success).toBe(false);
    expect(p.previewUrl).toBeNull();
  });
});

describe('NotificationManager — resolveWebhookUrl', () => {
  it('prefers the explicit arg, then env, else null', () => {
    expect(resolveWebhookUrl('https://explicit')).toBe('https://explicit');
    process.env.BUILD_WEBHOOK_URL = 'https://env';
    expect(resolveWebhookUrl()).toBe('https://env');
    delete process.env.BUILD_WEBHOOK_URL;
    expect(resolveWebhookUrl()).toBeNull();
    expect(resolveWebhookUrl('   ')).toBeNull();
  });
});

describe('NotificationManager — sendBuildWebhook', () => {
  it('returns true on a 2xx and posts JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const ok = await sendBuildWebhook('https://hook', buildNotificationPayload(job({}), 't'));
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hook');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).jobId).toBe('job-1');
  });

  it('returns false (never throws) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await sendBuildWebhook('https://hook', buildNotificationPayload(job({}), 't'))).toBe(false);
  });

  it('returns false on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await sendBuildWebhook('https://hook', buildNotificationPayload(job({}), 't'))).toBe(false);
  });
});

describe('NotificationManager — notifyBuildResult', () => {
  it('no-ops when no webhook is configured (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await notifyBuildResult(job({ status: JobStatus.PREVIEW_READY })); // no env, no arg
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops for a non-terminal status even with a webhook set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await notifyBuildResult(job({ status: JobStatus.BUILDING }), { webhookUrl: 'https://hook' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fires the webhook for a terminal status when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await notifyBuildResult(job({ status: JobStatus.FAILED }), { webhookUrl: 'https://hook' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
