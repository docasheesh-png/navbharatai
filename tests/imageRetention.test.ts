/**
 * THE IMAGE CLEANUP'S SAFETY MODEL, asserted rather than described.
 *
 * This is a DELETING job that runs against users' live apps, so the tests worth having are the ones
 * that fail if a guard is ever removed — not the ones that confirm the happy path. Three in
 * particular:
 *
 *   1. an image a live revision runs is never deleted, INCLUDING when it is older than the newest N
 *      (the failed-publish case, which is the one a native registry cleanup policy gets wrong);
 *   2. an unreadable service state deletes nothing, while a CONFIRMED 404 deletes freely — the two
 *      are different facts and collapsing them makes the feature either unsafe or useless;
 *   3. every knob treats an empty env value as unset rather than as zero.
 */
import { describe, it, expect } from 'vitest';
import {
  decideImagePrune, cleanupMode, keepImages, minImageAgeMs, maxDeletesPerRun,
  parseImageList, parseRevisionImages, splitImageRefs, versionsSizeMb,
  buildListImagesRequest, buildDeleteVersionRequest, buildListRevisionsRequest,
  DEFAULT_KEEP_IMAGES, DEFAULT_MAX_DELETES, DEFAULT_MIN_AGE_MS,
  type ImageVersion,
} from '../src/server/AgentV3/imageRetention';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-13T12:00:00Z');

function img(over: Partial<ImageVersion> & { digest: string }): ImageVersion {
  return {
    service: 'todo-ab12cd',
    versionName: `projects/p/locations/asia-south1/repositories/nbai-apps/packages/todo-ab12cd/versions/${over.digest}`,
    createdAtMs: NOW - 30 * 24 * HOUR,
    tags: [],
    sizeBytes: 300 * 1024 * 1024,
    ...over,
  };
}

describe('decideImagePrune — the in-use guard', () => {
  it('never deletes a digest a live revision runs, even when it is far outside the newest N', () => {
    // The failed-publish shape: traffic is stuck on the OLDEST image while four newer, broken
    // images crowd it out of any "keep the newest 3" window.
    const live = img({ digest: 'sha256:old', createdAtMs: NOW - 90 * 24 * HOUR });
    const versions = [
      live,
      img({ digest: 'sha256:n1', createdAtMs: NOW - 10 * 24 * HOUR }),
      img({ digest: 'sha256:n2', createdAtMs: NOW - 9 * 24 * HOUR }),
      img({ digest: 'sha256:n3', createdAtMs: NOW - 8 * 24 * HOUR }),
      img({ digest: 'sha256:n4', createdAtMs: NOW - 7 * 24 * HOUR }),
    ];
    const d = decideImagePrune({
      versions, usage: { kind: 'in-use', digests: ['sha256:old'], tags: [] },
      keep: 3, minAgeMs: DEFAULT_MIN_AGE_MS, now: NOW,
    });
    expect(d.prune.map((v) => v.digest)).not.toContain('sha256:old');
    expect(d.kept.find((k) => k.version.digest === 'sha256:old')!.reason).toMatch(/live revision/);
    // The three NEWEST broken images are kept as rollback targets; the oldest of that batch loses
    // its slot to the live image. Exactly one goes, and it is not the one that is running.
    expect(d.prune.map((v) => v.digest)).toEqual(['sha256:n1']);
  });

  it('protects an image referenced by TAG as well as by digest', () => {
    const versions = [
      img({ digest: 'sha256:a', tags: ['20260901120000'], createdAtMs: NOW - 60 * 24 * HOUR }),
      img({ digest: 'sha256:b', createdAtMs: NOW - 5 * 24 * HOUR }),
      img({ digest: 'sha256:c', createdAtMs: NOW - 4 * 24 * HOUR }),
      img({ digest: 'sha256:d', createdAtMs: NOW - 3 * 24 * HOUR }),
    ];
    const d = decideImagePrune({
      versions, usage: { kind: 'in-use', digests: [], tags: ['20260901120000'] },
      keep: 3, minAgeMs: DEFAULT_MIN_AGE_MS, now: NOW,
    });
    expect(d.prune.map((v) => v.digest)).not.toContain('sha256:a');
  });

  it('deletes nothing at all when the service state is unknown', () => {
    const versions = Array.from({ length: 10 }, (_, i) => img({ digest: `sha256:${i}`, createdAtMs: NOW - (100 + i) * 24 * HOUR }));
    const d = decideImagePrune({
      versions, usage: { kind: 'unknown', reason: 'HTTP 503' },
      keep: 1, minAgeMs: DEFAULT_MIN_AGE_MS, now: NOW,
    });
    expect(d.prune).toHaveLength(0);
    expect(d.kept).toHaveLength(10);
    expect(d.kept[0].reason).toMatch(/unreadable/);
  });

  it('a CONFIRMED missing service still keeps the newest N — a takedown can be re-published', () => {
    const versions = [
      img({ digest: 'sha256:a', createdAtMs: NOW - 10 * 24 * HOUR }),
      img({ digest: 'sha256:b', createdAtMs: NOW - 9 * 24 * HOUR }),
      img({ digest: 'sha256:c', createdAtMs: NOW - 8 * 24 * HOUR }),
    ];
    const d = decideImagePrune({
      versions, usage: { kind: 'no-service' }, keep: 3, minAgeMs: DEFAULT_MIN_AGE_MS, now: NOW,
    });
    expect(d.prune).toHaveLength(0);
  });

  it('a CONFIRMED missing service prunes everything past the keep window — this is the biggest pile', () => {
    const versions = Array.from({ length: 8 }, (_, i) => img({ digest: `sha256:${i}`, createdAtMs: NOW - (20 - i) * 24 * HOUR }));
    const d = decideImagePrune({
      versions, usage: { kind: 'no-service' }, keep: 2, minAgeMs: DEFAULT_MIN_AGE_MS, now: NOW,
    });
    expect(d.prune).toHaveLength(6);
    // Oldest first, so a bounded run spends its budget on the stalest waste.
    expect(d.prune[0].createdAtMs! < d.prune[d.prune.length - 1].createdAtMs!).toBe(true);
  });

  it('never deletes an image younger than the age floor, whatever its rank', () => {
    const versions = [
      img({ digest: 'sha256:a', createdAtMs: NOW - 2 * HOUR }),
      img({ digest: 'sha256:b', createdAtMs: NOW - 3 * HOUR }),
      img({ digest: 'sha256:c', createdAtMs: NOW - 4 * HOUR }),
      img({ digest: 'sha256:d', createdAtMs: NOW - 5 * HOUR }),
    ];
    const d = decideImagePrune({
      versions, usage: { kind: 'no-service' }, keep: 1, minAgeMs: DEFAULT_MIN_AGE_MS, now: NOW,
    });
    expect(d.prune).toHaveLength(0);
    expect(d.kept.filter((k) => /floor/.test(k.reason))).toHaveLength(3);
  });

  it('never deletes an image whose pushed time the registry did not report', () => {
    const versions = [
      img({ digest: 'sha256:known', createdAtMs: NOW - 40 * 24 * HOUR }),
      img({ digest: 'sha256:undated', createdAtMs: null }),
      img({ digest: 'sha256:old', createdAtMs: NOW - 50 * 24 * HOUR }),
    ];
    const d = decideImagePrune({
      versions, usage: { kind: 'no-service' }, keep: 1, minAgeMs: DEFAULT_MIN_AGE_MS, now: NOW,
    });
    expect(d.prune.map((v) => v.digest)).not.toContain('sha256:undated');
  });

  it('an empty registry is not an error', () => {
    const d = decideImagePrune({ versions: [], usage: { kind: 'no-service' }, keep: 3, minAgeMs: DEFAULT_MIN_AGE_MS, now: NOW });
    expect(d.prune).toHaveLength(0);
    expect(d.kept).toHaveLength(0);
  });
});

describe('the knobs — empty means unset, never zero', () => {
  it('an empty NAVBHARAT_IMAGE_KEEP keeps the default, not zero images', () => {
    expect(keepImages({ NAVBHARAT_IMAGE_KEEP: '' } as NodeJS.ProcessEnv)).toBe(DEFAULT_KEEP_IMAGES);
    expect(keepImages({ NAVBHARAT_IMAGE_KEEP: '   ' } as NodeJS.ProcessEnv)).toBe(DEFAULT_KEEP_IMAGES);
    expect(keepImages({} as NodeJS.ProcessEnv)).toBe(DEFAULT_KEEP_IMAGES);
  });

  it('an empty delete bound keeps the default, so a run can never become unbounded', () => {
    expect(maxDeletesPerRun({ NAVBHARAT_IMAGE_MAX_DELETES: '' } as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_DELETES);
    expect(maxDeletesPerRun({ NAVBHARAT_IMAGE_MAX_DELETES: 'lots' } as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_DELETES);
  });

  it('an empty age floor keeps the default, so an in-flight publish is never deleted', () => {
    expect(minImageAgeMs({ NAVBHARAT_IMAGE_MIN_AGE_HOURS: '' } as NodeJS.ProcessEnv)).toBe(DEFAULT_MIN_AGE_MS);
    expect(minImageAgeMs({ NAVBHARAT_IMAGE_MIN_AGE_HOURS: '0' } as NodeJS.ProcessEnv)).toBe(HOUR);
  });

  it('the knobs clamp rather than accepting anything', () => {
    expect(keepImages({ NAVBHARAT_IMAGE_KEEP: '99999' } as NodeJS.ProcessEnv)).toBe(100);
    expect(keepImages({ NAVBHARAT_IMAGE_KEEP: '-5' } as NodeJS.ProcessEnv)).toBe(1);
    expect(maxDeletesPerRun({ NAVBHARAT_IMAGE_MAX_DELETES: '100000' } as NodeJS.ProcessEnv)).toBe(500);
  });

  it('the mode defaults to on, and off/report are both reachable', () => {
    expect(cleanupMode({} as NodeJS.ProcessEnv)).toBe('on');
    expect(cleanupMode({ NAVBHARAT_IMAGE_CLEANUP: 'off' } as NodeJS.ProcessEnv)).toBe('off');
    expect(cleanupMode({ NAVBHARAT_IMAGE_CLEANUP: 'REPORT' } as NodeJS.ProcessEnv)).toBe('report');
    expect(cleanupMode({ NAVBHARAT_IMAGE_CLEANUP: 'dry-run' } as NodeJS.ProcessEnv)).toBe('report');
    expect(cleanupMode({ NAVBHARAT_IMAGE_CLEANUP: 'on' } as NodeJS.ProcessEnv)).toBe('on');
  });
});

describe('reading what Google actually sends back', () => {
  it('parses a dockerImages page into deletable version paths', () => {
    const { images, nextPageToken } = parseImageList({
      dockerImages: [{
        name: 'projects/navbharatai-user-apps/locations/asia-south1/repositories/nbai-apps/dockerImages/todo-ab12cd@sha256:deadbeef',
        uri: 'asia-south1-docker.pkg.dev/navbharatai-user-apps/nbai-apps/todo-ab12cd@sha256:deadbeef',
        tags: ['20260913120000'],
        imageSizeBytes: '314572800',
        uploadTime: '2026-09-13T12:00:00Z',
        buildTime: '2026-01-01T00:00:00Z',
      }],
      nextPageToken: 'next',
    });
    expect(images).toHaveLength(1);
    expect(images[0].service).toBe('todo-ab12cd');
    expect(images[0].digest).toBe('sha256:deadbeef');
    expect(images[0].versionName).toBe(
      'projects/navbharatai-user-apps/locations/asia-south1/repositories/nbai-apps/packages/todo-ab12cd/versions/sha256:deadbeef',
    );
    expect(images[0].sizeBytes).toBe(314572800);
    expect(nextPageToken).toBe('next');
  });

  it('takes the age from uploadTime, NOT buildTime — a cached layer makes buildTime stale', () => {
    const { images } = parseImageList({
      dockerImages: [{
        name: 'projects/p/locations/r/repositories/nbai-apps/dockerImages/svc@sha256:a',
        uploadTime: '2026-09-13T12:00:00Z',
        buildTime: '2020-01-01T00:00:00Z',
      }],
    });
    expect(images[0].createdAtMs).toBe(Date.parse('2026-09-13T12:00:00Z'));
  });

  it('a malformed or missing row is skipped, never guessed at', () => {
    expect(parseImageList(null).images).toHaveLength(0);
    expect(parseImageList({ dockerImages: 'nope' }).images).toHaveLength(0);
    expect(parseImageList({ dockerImages: [{ name: 'no-digest-here' }] }).images).toHaveLength(0);
    expect(parseImageList({ dockerImages: [{ name: 'a/dockerImages/svc@notadigest' }] }).images).toHaveLength(0);
    const { images } = parseImageList({
      dockerImages: [{ name: 'projects/p/locations/r/repositories/nbai-apps/dockerImages/svc@sha256:a' }],
    });
    expect(images[0].createdAtMs).toBeNull();
    expect(images[0].sizeBytes).toBeNull();
  });

  it('reads every image a service runs out of its revisions', () => {
    const refs = parseRevisionImages({
      revisions: [
        { containers: [{ image: 'asia-south1-docker.pkg.dev/p/nbai-apps/svc@sha256:live' }] },
        { containers: [{ image: 'asia-south1-docker.pkg.dev/p/nbai-apps/svc:20260901' }] },
        { containers: [] },
        {},
      ],
    });
    expect(refs).toHaveLength(2);
  });

  it('splits digest and tag references, and a registry port is not a tag', () => {
    const s = splitImageRefs([
      'asia-south1-docker.pkg.dev/p/r/svc@sha256:abc',
      'asia-south1-docker.pkg.dev/p/r/svc:v7',
      'localhost:5000/svc',
      '',
    ]);
    expect(s.digests).toEqual(['sha256:abc']);
    expect(s.tags).toEqual(['v7']);
  });
});

describe('the requests', () => {
  it('lists images from the apps repository, paged', () => {
    const r = buildListImagesRequest('tok', 'proj', 'asia-south1', 'nbai-apps', 200, 'pg');
    expect(r.method).toBe('GET');
    expect(r.url).toContain('/projects/proj/locations/asia-south1/repositories/nbai-apps/dockerImages?');
    expect(r.url).toContain('pageToken=pg');
    expect(r.headers.Authorization).toBe('Bearer tok');
  });

  it('deletes with force, because every image we push is tagged', () => {
    const r = buildDeleteVersionRequest('tok', 'projects/p/locations/r/repositories/nbai-apps/packages/svc/versions/sha256:a');
    expect(r.method).toBe('DELETE');
    expect(r.url).toMatch(/\?force=true$/);
    expect(r.url).toContain('/versions/sha256:a');
  });

  it('reads revisions from the service the images belong to', () => {
    const r = buildListRevisionsRequest('tok', 'proj', 'asia-south1', 'todo-ab12cd');
    expect(r.url).toContain('run.googleapis.com/v2/projects/proj/locations/asia-south1/services/todo-ab12cd/revisions');
  });
});

describe('the reclaimed figure is a measurement or nothing', () => {
  it('reports null rather than 0 when no image carried a size', () => {
    expect(versionsSizeMb([img({ digest: 'sha256:a', sizeBytes: null })])).toBeNull();
    expect(versionsSizeMb([])).toBeNull();
  });

  it('sums only the images that reported one', () => {
    const mb = versionsSizeMb([
      img({ digest: 'sha256:a', sizeBytes: 100 * 1024 * 1024 }),
      img({ digest: 'sha256:b', sizeBytes: null }),
    ]);
    expect(mb).toBe(100);
  });
});
