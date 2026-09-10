import { describe, it, expect } from 'vitest';
import {
  appsImageRepo, buildStagingBucket, imageUriFor, buildTag, sourceObjectFor,
  buildUploadSourceRequest, buildCreateBuildRequest, buildGetBuildRequest,
  buildPhase, parseBuild, buildFailureMessage, buildAppContainer,
  BUILDPACKS_BUILDER, PACK_IMAGE, BUILD_TIMEOUT_SECONDS,
} from '../src/server/AgentV3/containerBuild';

/**
 * Source → container, with no Dockerfile and no GitHub (ROADMAP §11, slice 1b).
 *
 * Render reads code from a repository, which is the whole reason hosting a backend has meant "first
 * put this app in a repo". Cloud Build reads it from a Cloud Storage object, so the app goes straight
 * from NavBharatAI's durable store to a running service.
 */
const okRes = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  text: async () => JSON.stringify(body ?? ''),
});
const noSleep = async () => {};

describe('naming and addresses', () => {
  it('🔒 the image tag is FRESH per build — a moving tag would let a deploy serve the previous build', () => {
    // Reusing `latest` means a failed build leaves the old image in place and the deploy reports the
    // new one as live. The tag is what makes "we ran exactly what this build produced" true.
    const a = buildTag(Date.parse('2026-09-07T19:30:00Z'), 'ws1');
    const b = buildTag(Date.parse('2026-09-07T19:31:00Z'), 'ws1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{14}-ws1$/);
    expect(imageUriFor('p', 'asia-south1', 'svc', a)).not.toContain(':latest');
  });

  it('the image address is a real Artifact Registry path', () => {
    expect(imageUriFor('apps-prod', 'asia-south1', 'mitrify-ab12', '20260907', 'nbai-apps'))
      .toBe('asia-south1-docker.pkg.dev/apps-prod/nbai-apps/mitrify-ab12:20260907');
  });

  it('staging defaults to Cloud Build\'s own bucket, so the common case needs no extra setup', () => {
    expect(buildStagingBucket('apps-prod', {} as NodeJS.ProcessEnv)).toBe('apps-prod_cloudbuild');
    expect(buildStagingBucket('p', { NAVBHARAT_APPS_BUILD_BUCKET: 'mine' } as NodeJS.ProcessEnv)).toBe('mine');
    expect(appsImageRepo({} as NodeJS.ProcessEnv)).toBe('nbai-apps');
  });

  it('each build stages its own object, so two builds never overwrite one another mid-flight', () => {
    expect(sourceObjectFor('svc', 't1')).not.toBe(sourceObjectFor('svc', 't2'));
    expect(sourceObjectFor('svc', 't1')).toMatch(/\.tar\.gz$/);
  });
});

describe('request builders', () => {
  it('the source upload is sent as a gzipped tarball — the one shape Cloud Build reads', () => {
    const r = buildUploadSourceRequest('tok', 'bkt', 'nbai-source/a/b.tar.gz', Buffer.from('x'));
    expect(r.url).toContain('/b/bkt/o?uploadType=media&name=');
    expect(r.headers['Content-Type']).toBe('application/gzip');
    expect(r.headers.Authorization).toBe('Bearer tok');
  });

  it('🔒 the build uses PINNED buildpacks — a floating builder would change every app\'s build silently', () => {
    const r = buildCreateBuildRequest('tok', 'p', 'asia-south1', { bucket: 'b', object: 'o', image: 'img:1' });
    const body = JSON.parse(String(r.body));
    expect(body.steps[0].name).toBe(PACK_IMAGE);
    expect(body.steps[0].args).toContain(`--builder=${BUILDPACKS_BUILDER}`);
    expect(BUILDPACKS_BUILDER).not.toContain(':latest');
    expect(body.source.storageSource).toEqual({ bucket: 'b', object: 'o' });
  });

  it('🔒 the build is time-bounded, because build minutes are a billed cost line (D5)', () => {
    const body = JSON.parse(String(buildCreateBuildRequest('t', 'p', 'r', { bucket: 'b', object: 'o', image: 'i' }).body));
    expect(body.timeout).toBe(`${BUILD_TIMEOUT_SECONDS}s`);
    expect(BUILD_TIMEOUT_SECONDS).toBeLessThanOrEqual(1800);
  });

  it('pack publishes the image itself, so success means the image genuinely exists', () => {
    const body = JSON.parse(String(buildCreateBuildRequest('t', 'p', 'r', { bucket: 'b', object: 'o', image: 'img:1' }).body));
    expect(body.steps[0].args).toContain('--publish');
    expect(body.steps[0].args).toContain('img:1');
  });

  it('reading a build back is a GET on its id', () => {
    const r = buildGetBuildRequest('tok', 'p', 'r', 'build-9');
    expect(r.method).toBe('GET');
    expect(r.url).toMatch(/\/builds\/build-9$/);
  });
});

describe('buildPhase — an unfamiliar status is never read as success', () => {
  it('maps the statuses Cloud Build documents', () => {
    expect(buildPhase('SUCCESS')).toBe('success');
    for (const s of ['FAILURE', 'TIMEOUT', 'CANCELLED', 'INTERNAL_ERROR', 'EXPIRED']) expect(buildPhase(s), s).toBe('failed');
    for (const s of ['QUEUED', 'WORKING', 'PENDING']) expect(buildPhase(s), s).toBe('in-progress');
  });

  it('🔒 a status we do not recognise is "unknown" — never success', () => {
    // Google can add a status tomorrow; reading it as success would report a container that does not
    // exist as ready to deploy.
    expect(buildPhase('SOME_NEW_STATUS')).toBe('unknown');
    expect(buildPhase('')).toBe('unknown');
    expect(buildPhase(null)).toBe('unknown');
  });
});

describe('parseBuild — reads both the create (Operation) and the get shapes', () => {
  it('finds the build inside an Operation, and directly', () => {
    expect(parseBuild({ metadata: { build: { id: 'b1', status: 'QUEUED' } } })?.id).toBe('b1');
    expect(parseBuild({ id: 'b2', status: 'SUCCESS' })?.phase).toBe('success');
    expect(parseBuild({ build: { id: 'b3', status: 'WORKING' } })?.phase).toBe('in-progress');
  });

  it('carries the admin-only detail and log URL, and rejects junk', () => {
    const p = parseBuild({ id: 'b', status: 'FAILURE', statusDetail: 'step 0 failed', logUrl: 'https://logs' })!;
    expect(p.detail).toBe('step 0 failed');
    expect(p.logUrl).toBe('https://logs');
    for (const junk of [null, {}, 'nope', { id: '  ' }]) expect(parseBuild(junk)).toBeNull();
  });
});

describe('buildFailureMessage — the app\'s problem, said as something fixable', () => {
  it('a timeout names the limit and what usually causes it', () => {
    const m = buildFailureMessage('failed', 'TIMEOUT');
    expect(m).toContain('15 minutes');
    expect(m).toMatch(/dependency install/i);
  });

  it('a failure points at the build, never at the platform, and always says nothing was deployed', () => {
    for (const [p, s] of [['failed', 'FAILURE'], ['unknown', '']] as const) {
      const m = buildFailureMessage(p, s);
      expect(m).toMatch(/[Nn]othing was deployed/);
    }
    expect(buildFailureMessage('failed', 'FAILURE')).toMatch(/missing dependency|build script/i);
  });
});

describe('buildAppContainer — honest at every branch, never throws', () => {
  const base = {
    token: 't', projectId: 'apps-prod', region: 'asia-south1', bucket: 'apps-prod_cloudbuild',
    service: 'mitrify-ab12', tag: '20260907', archive: Buffer.from('tar'), pollMs: 1, maxWaitMs: 1000,
  };

  it('uploads, builds, and returns the image it actually produced', async () => {
    let polls = 0;
    const res = await buildAppContainer(base, (async (url: any, init: any) => {
      if (String(url).includes('uploadType=media')) return okRes({});
      if (init?.method === 'POST') return okRes({ metadata: { build: { id: 'b1', status: 'QUEUED' } } });
      polls += 1;
      return okRes({ id: 'b1', status: polls >= 2 ? 'SUCCESS' : 'WORKING' });
    }) as any, noSleep);
    expect(res.ok).toBe(true);
    expect(res.ok && res.image).toBe('asia-south1-docker.pkg.dev/apps-prod/nbai-apps/mitrify-ab12:20260907');
    expect(res.ok && res.buildId).toBe('b1');
  });

  it('🔒 a failed upload never starts a build', async () => {
    let started = false;
    const res = await buildAppContainer(base, (async (url: any, init: any) => {
      if (String(url).includes('uploadType=media')) return okRes({}, 403);
      if (init?.method === 'POST') started = true;
      return okRes({});
    }) as any, noSleep);
    expect(started).toBe(false);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('upload-failed');
  });

  it('🔒 a 2xx we cannot read is NOT a started build', async () => {
    // Claiming one leaves the caller waiting for an image nothing is producing.
    const res = await buildAppContainer(base, (async (url: any, init: any) => (
      String(url).includes('uploadType=media') ? okRes({}) : init?.method === 'POST' ? okRes({ unexpected: true }) : okRes({})
    )) as any, noSleep);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('refused');
  });

  it('a failed build reports the user-facing reason AND keeps the detail for the admin', async () => {
    const res = await buildAppContainer(base, (async (url: any, init: any) => {
      if (String(url).includes('uploadType=media')) return okRes({});
      if (init?.method === 'POST') return okRes({ metadata: { build: { id: 'b9', status: 'WORKING' } } });
      return okRes({ id: 'b9', status: 'FAILURE', statusDetail: 'npm ERR! missing script: start', logUrl: 'https://logs/b9' });
    }) as any, noSleep);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('build-failed');
    expect(!res.ok && res.detail).toContain('missing script');
    expect(!res.ok && res.message).not.toContain('npm ERR');   // the raw log is admin-only
  });

  it('a build still running when the window closes says exactly that — not success, not failure', async () => {
    const res = await buildAppContainer({ ...base, maxWaitMs: 5 }, (async (url: any, init: any) => {
      if (String(url).includes('uploadType=media')) return okRes({});
      if (init?.method === 'POST') return okRes({ metadata: { build: { id: 'b2', status: 'WORKING' } } });
      return okRes({ id: 'b2', status: 'WORKING' });
    }) as any, noSleep);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('timed-out');
    expect(!res.ok && res.message).toMatch(/still building/i);
  });

  it('🔒 a lost poll is not a failed build — the window is what ends it', async () => {
    let polls = 0;
    const res = await buildAppContainer(base, (async (url: any, init: any) => {
      if (String(url).includes('uploadType=media')) return okRes({});
      if (init?.method === 'POST') return okRes({ metadata: { build: { id: 'b3', status: 'WORKING' } } });
      polls += 1;
      if (polls === 1) return okRes({}, 503);          // a hiccup
      return okRes({ id: 'b3', status: 'SUCCESS' });
    }) as any, noSleep);
    expect(res.ok).toBe(true);
  });

  it('never throws — a network failure is a reported reason', async () => {
    const res = await buildAppContainer(base, (async () => { throw new Error('offline'); }) as any, noSleep);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/Nothing was changed/i);
  });
});
