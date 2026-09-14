/**
 * THE SWEEP'S BEHAVIOUR — the half the pure rules cannot prove.
 *
 * `imageRetention.test.ts` asserts WHICH images may go. These tests assert what the job actually
 * DOES with that answer: that `report` mode deletes nothing at all, that the per-run bound really
 * stops it, that a 404 from Cloud Run and a 503 lead to opposite outcomes, and that no failure
 * anywhere can make it throw — because it runs inside the shared scheduler and a throw would take
 * every other scheduled job with it.
 *
 * The Google credential is stubbed, so these run with no project and no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getAccessToken = vi.fn(async () => 'test-token');
vi.mock('google-auth-library', () => ({
  GoogleAuth: class { getAccessToken = getAccessToken; },
}));

import { runImageCleanupSweep } from '../src/server/AgentV3/imageCleanupSweep';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const DAY = 86_400_000;
const ENV = {
  NAVBHARAT_APPS_PROJECT: 'navbharatai-user-apps',
  NAVBHARAT_APPS_REGION: 'asia-south1',
} as NodeJS.ProcessEnv;

function dockerImage(service: string, digest: string, ageDays: number, tags: string[] = []) {
  return {
    name: `projects/navbharatai-user-apps/locations/asia-south1/repositories/nbai-apps/dockerImages/${service}@${digest}`,
    tags,
    imageSizeBytes: String(300 * 1024 * 1024),
    uploadTime: new Date(NOW - ageDays * DAY).toISOString(),
  };
}

/** A fake Google. `revisions` maps a service to a status + body. */
function fakeGoogle(opts: {
  images: unknown[];
  revisions: Record<string, { status: number; images?: string[] }>;
  deleteStatus?: number;
  onDelete?: (url: string) => void;
  /** Staged Cloud Build source archives. Defaults to an empty bucket. */
  sources?: unknown[];
  sourcesStatus?: number;
}) {
  const deleted: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'DELETE') {
      deleted.push(url);
      opts.onDelete?.(url);
      const status = opts.deleteStatus ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as Response;
    }
    if (url.includes('storage.googleapis.com')) {
      const status = opts.sourcesStatus ?? 200;
      return {
        ok: status >= 200 && status < 300, status,
        json: async () => ({ items: opts.sources ?? [] }),
      } as Response;
    }
    if (url.includes('/dockerImages')) {
      return { ok: true, status: 200, json: async () => ({ dockerImages: opts.images }) } as Response;
    }
    if (url.includes('/revisions')) {
      const service = url.split('/services/')[1].split('/')[0];
      const r = opts.revisions[service] ?? { status: 404 };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => ({ revisions: (r.images ?? []).map((image) => ({ containers: [{ image }] })) }),
      } as Response;
    }
    return { ok: false, status: 500, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  return { impl, deleted };
}

beforeEach(() => { getAccessToken.mockResolvedValue('test-token'); });
afterEach(() => { vi.clearAllMocks(); });

describe('the sweep does what its mode says', () => {
  it('off deletes nothing and makes no call at all', async () => {
    const g = fakeGoogle({ images: [], revisions: {} });
    const spy = vi.fn(g.impl);
    const r = await runImageCleanupSweep({
      now: NOW, fetchImpl: spy as unknown as typeof fetch,
      env: { ...ENV, NAVBHARAT_IMAGE_CLEANUP: 'off' },
    });
    expect(r.mode).toBe('off');
    expect(spy).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('report finds the same images but deletes none of them', async () => {
    const g = fakeGoogle({
      images: [
        dockerImage('svc-a', 'sha256:1', 40), dockerImage('svc-a', 'sha256:2', 39),
        dockerImage('svc-a', 'sha256:3', 38), dockerImage('svc-a', 'sha256:4', 37),
        dockerImage('svc-a', 'sha256:5', 36),
      ],
      revisions: { 'svc-a': { status: 200, images: ['asia-south1-docker.pkg.dev/p/nbai-apps/svc-a@sha256:5'] } },
    });
    const r = await runImageCleanupSweep({
      now: NOW, fetchImpl: g.impl, env: { ...ENV, NAVBHARAT_IMAGE_CLEANUP: 'report' },
    });
    expect(r.mode).toBe('report');
    expect(r.scanned).toBe(5);
    expect(r.eligible).toBeGreaterThan(0);
    expect(r.deleted).toBe(0);
    expect(g.deleted).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/would delete/);
  });

  it('on actually deletes, and never the image the service is running', async () => {
    const live = 'sha256:5';
    const g = fakeGoogle({
      images: [
        dockerImage('svc-a', 'sha256:1', 40), dockerImage('svc-a', 'sha256:2', 39),
        dockerImage('svc-a', 'sha256:3', 38), dockerImage('svc-a', 'sha256:4', 37),
        dockerImage('svc-a', live, 36),
      ],
      revisions: { 'svc-a': { status: 200, images: [`asia-south1-docker.pkg.dev/p/nbai-apps/svc-a@${live}`] } },
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.deleted).toBeGreaterThan(0);
    expect(r.deleted).toBe(r.eligible);
    expect(g.deleted.join(' ')).not.toContain(live);
    expect(r.reclaimedMb).toBeGreaterThan(0);
  });
});

describe('the guards, end to end', () => {
  it('a 503 on the revisions read deletes NOTHING for that app', async () => {
    const g = fakeGoogle({
      images: Array.from({ length: 9 }, (_, i) => dockerImage('svc-a', `sha256:${i}`, 90 - i)),
      revisions: { 'svc-a': { status: 503 } },
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.deleted).toBe(0);
    expect(g.deleted).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/unreadable/);
  });

  it('a 404 on the revisions read DOES clean up — the app is gone, nothing can pull its images', async () => {
    const g = fakeGoogle({
      images: Array.from({ length: 9 }, (_, i) => dockerImage('gone-app', `sha256:${i}`, 90 - i)),
      revisions: {},  // every lookup 404s
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.deleted).toBe(6);  // 9 images, keep the newest 3
    expect(r.notes.join(' ')).toMatch(/no longer hosted/);
  });

  it('the per-run bound stops the run and says the backlog remains', async () => {
    const g = fakeGoogle({
      images: Array.from({ length: 40 }, (_, i) => dockerImage('gone-app', `sha256:${i}`, 200 - i)),
      revisions: {},
    });
    const r = await runImageCleanupSweep({
      now: NOW, fetchImpl: g.impl, env: { ...ENV, NAVBHARAT_IMAGE_MAX_DELETES: '5' },
    });
    expect(r.deleted).toBe(5);
    expect(r.boundHit).toBe(true);
    expect(r.notes.join(' ')).toMatch(/cleanup policy/);
  });

  it('an app whose images are all younger than the floor is left alone entirely', async () => {
    const g = fakeGoogle({
      images: Array.from({ length: 9 }, (_, i) => dockerImage('fresh', `sha256:${i}`, 0)),
      revisions: {},
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.deleted).toBe(0);
  });
});

describe('it never throws, and never claims work it did not do', () => {
  it('an unconfigured apps project is reported, not thrown', async () => {
    const g = fakeGoogle({ images: [], revisions: {} });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: {} as NodeJS.ProcessEnv });
    expect(r.deleted).toBe(0);
    expect(r.notes.join(' ')).toMatch(/not switched on|Image cleanup skipped/);
  });

  it('no Google credential stops the run before anything is deleted', async () => {
    getAccessToken.mockResolvedValue(null as unknown as string);
    const g = fakeGoogle({ images: [dockerImage('a', 'sha256:1', 90)], revisions: {} });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.deleted).toBe(0);
    expect(g.deleted).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/authenticate/);
  });

  it('a registry that throws is an incomplete read, not a crash', async () => {
    const boom = (async () => { throw new Error('socket hang up'); }) as unknown as typeof fetch;
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: boom, env: ENV });
    expect(r.complete).toBe(false);
    expect(r.deleted).toBe(0);
    expect(r.notes.join(' ')).toMatch(/Could not reach the registry/);
  });

  it('a 404 on the repository itself means nothing has been published — a complete, empty run', async () => {
    const impl = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: impl, env: ENV });
    expect(r.complete).toBe(true);
    expect(r.scanned).toBe(0);
    expect(r.notes).toHaveLength(0);
  });

  it('a delete that FAILS is not counted as one, and is named', async () => {
    const g = fakeGoogle({
      images: Array.from({ length: 5 }, (_, i) => dockerImage('gone', `sha256:${i}`, 90 - i)),
      revisions: {},
      deleteStatus: 403,
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(g.deleted.length).toBeGreaterThan(0);
    expect(r.deleted).toBe(0);
    expect(r.reclaimedMb).toBeNull();
    expect(r.notes.join(' ')).toMatch(/could not delete/);
  });

  it('a 404 on the delete IS success — the image is already gone', async () => {
    const g = fakeGoogle({
      images: Array.from({ length: 5 }, (_, i) => dockerImage('gone', `sha256:${i}`, 90 - i)),
      revisions: {},
      deleteStatus: 404,
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.deleted).toBe(2);
  });

  it('a delete that throws does not stop the run or the job', async () => {
    let calls = 0;
    const g = fakeGoogle({
      images: Array.from({ length: 6 }, (_, i) => dockerImage('gone', `sha256:${i}`, 90 - i)),
      revisions: {},
      onDelete: () => { calls++; if (calls === 1) throw new Error('reset by peer'); },
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.deleted).toBe(2);       // three eligible, one threw
    expect(r.notes.join(' ')).toMatch(/reset by peer/);
  });
});

/**
 * THE SIBLING — staged Cloud Build source archives.
 *
 * Same root cause as the images (nothing ever deleted them), different retention rule: a source
 * object is read exactly once by the build it was uploaded for, so the age floor is the whole policy.
 */
function srcObj(name: string, ageDays: number, mb = 4) {
  return {
    name: `nbai-source/${name}`,
    timeCreated: new Date(NOW - ageDays * DAY).toISOString(),
    size: String(mb * 1024 * 1024),
  };
}

describe('staged build sources are cleaned too', () => {
  it('deletes staged sources past the age floor and reports the MB', async () => {
    const g = fakeGoogle({
      images: [], revisions: {},
      sources: [srcObj('svc-a/20260101.tar.gz', 90), srcObj('svc-a/20260201.tar.gz', 60)],
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.sourcesDeleted).toBe(2);
    expect(r.sourcesReclaimedMb).toBe(8);
    expect(r.notes.join(' ')).toMatch(/staged sources: deleted 2 of 2/);
  });

  it('never deletes one younger than the floor — a build could still be reading it', async () => {
    const g = fakeGoogle({ images: [], revisions: {}, sources: [srcObj('svc-a/now.tar.gz', 0)] });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.sourcesDeleted).toBe(0);
  });

  it('ignores anything outside our own prefix, whatever the listing returns', async () => {
    const g = fakeGoogle({
      images: [], revisions: {},
      sources: [
        { name: 'someone-elses/build.tar.gz', timeCreated: new Date(NOW - 90 * DAY).toISOString(), size: '999' },
        srcObj('svc-a/mine.tar.gz', 90),
      ],
    });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.sourcesDeleted).toBe(1);
    expect(g.deleted.join(' ')).not.toContain('someone-elses');
  });

  it('report mode names them without deleting', async () => {
    const g = fakeGoogle({ images: [], revisions: {}, sources: [srcObj('svc-a/old.tar.gz', 90)] });
    const r = await runImageCleanupSweep({
      now: NOW, fetchImpl: g.impl, env: { ...ENV, NAVBHARAT_IMAGE_CLEANUP: 'report' },
    });
    expect(r.sourcesDeleted).toBe(0);
    expect(g.deleted).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/would delete 1 of 1/);
  });

  it('a bucket that does not exist yet is silent, not an error', async () => {
    const g = fakeGoogle({ images: [], revisions: {}, sourcesStatus: 404 });
    const r = await runImageCleanupSweep({ now: NOW, fetchImpl: g.impl, env: ENV });
    expect(r.sourcesDeleted).toBe(0);
    expect(r.notes).toHaveLength(0);
  });

  it('the per-run bound is SHARED with the images, so one run can never double-spend it', async () => {
    const g = fakeGoogle({
      images: Array.from({ length: 8 }, (_, i) => dockerImage('gone', `sha256:${i}`, 90 - i)),
      revisions: {},
      sources: Array.from({ length: 8 }, (_, i) => srcObj(`gone/${i}.tar.gz`, 90 - i)),
    });
    const r = await runImageCleanupSweep({
      now: NOW, fetchImpl: g.impl, env: { ...ENV, NAVBHARAT_IMAGE_MAX_DELETES: '3' },
    });
    expect(r.deleted + r.sourcesDeleted).toBe(3);
    expect(r.boundHit).toBe(true);
  });
});
