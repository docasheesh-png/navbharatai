/**
 * Q-3363 (admin 2026-11-26, option A): the playtest's proof pictures are kept in the EXISTING private bucket for 30 days,
 * seen only through an admin-authenticated route, and GAME_PROOF carries the stored keys. Every cap and every refusal
 * is said, never silent.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockReq, mockRes } from './helpers/routeTestUtils';

const bucketCalls = vi.hoisted(() => ({ names: [] as string[], saved: [] as Array<{ key: string; opts: any }>, deleted: [] as string[] }));
vi.mock('firebase-admin', async (original) => ({
  ...await original<typeof import('firebase-admin')>(),
  storage: () => ({
    bucket: (name: string) => {
      bucketCalls.names.push(name);
      return {
        file: (key: string) => ({ save: async (_b: Buffer, opts: any) => { bucketCalls.saved.push({ key, opts }); } }),
        getFiles: async () => [[], null, { prefixes: ['game-proof-v1/2026-10-01/', 'game-proof-v1/2026-11-20/'] }],
        deleteFiles: async ({ prefix }: { prefix: string }) => { bucketCalls.deleted.push(prefix); },
      };
    },
  }),
}));

import {
  MAX_PICTURE_BYTES, KEEP_BUDGET_MS, gameProofKeeper, isProofPictureKey, keepProofPictures, privateProofPictureStore, proofPictureExpired,
  proofPictureKeepEnabled, readProofPicture, sandboxPictureReader, sweepExpiredProofPictures, maybeSweepProofPictures,
  __resetProofPictureSweepForTests, type ProofPictureStore,
} from '../src/server/AgentV3/gameProofPictures';
import { registerGameProofPicturesAdminRoutes } from '../src/server/routes/gameProofPicturesAdmin';
import { gameProof, gameProofIssue } from '../src/server/AgentV3/gameProof';
import { runGamePlaytestPhase, type PlaytestIssue } from '../src/server/AgentV3/buildPhases/gamePlaytestPhase';
import { PLAYTEST_RESULT_MARKER, type ProofShot } from '../src/server/AgentV3/gamePlaytest';
import { proofPicturesFromIssues, proofPictureError } from '../src/components/admin/GameProofPictures';
import { readWorkspaceReports } from '../src/components/admin/WorkspaceBuildReports';

const NOW = Date.parse('2026-11-26T10:00:00Z');
const jpeg = (fill: number, size = 2000) => { const b = Buffer.alloc(size, fill); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const idOf = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 12);
const shotFor = (view: string, b: Buffer): ProofShot => ({ view, id: idOf(b), w: 480, h: 270, bytes: b.length, path: `/tmp/nbai-playtest-proof/${view}-${idOf(b)}.jpg` });

function memoryStore(): ProofPictureStore & { objects: Map<string, { bytes: Buffer; meta: Record<string, string> }>; deletedDays: string[] } {
  const objects = new Map<string, { bytes: Buffer; meta: Record<string, string> }>();
  const deletedDays: string[] = [];
  return {
    objects, deletedDays,
    async save(key, bytes, meta) { objects.set(key, { bytes, meta }); },
    async read(key, max) { const o = objects.get(key); if (!o) return null; if (o.bytes.length > max) throw new Error('cap'); return o.bytes; },
    async listDays() { return [...new Set([...objects.keys()].map((k) => k.split('/').slice(0, 2).join('/') + '/'))]; },
    async deleteDay(day) { deletedDays.push(day); for (const k of [...objects.keys()]) if (k.startsWith(day)) objects.delete(k); },
  };
}
const files = (m: Record<string, Buffer>) => async (p: string) => m[p] ?? null;

beforeEach(() => { bucketCalls.names.length = 0; bucketCalls.saved.length = 0; bucketCalls.deleted.length = 0; __resetProofPictureSweepForTests(); });

describe('keeping the pictures: the existing private bucket, three a build, each checked', () => {
  it('three valid pictures are stored under game-proof-v1/<day>/<build>/, each with its delete-after date', async () => {
    const pics = [jpeg(1), jpeg(2), jpeg(3)];
    const shots = [shotFor('start', pics[0]), shotFor('moved', pics[1]), shotFor('far', pics[2])];
    const store = memoryStore();
    const r = await keepProofPictures({ buildId: 'b-123', shots, read: files(Object.fromEntries(shots.map((s, i) => [s.path, pics[i]]))), store, nowMs: NOW });
    expect(r.notKept).toEqual([]);
    expect(r.kept.map((k) => k.key)).toEqual(shots.map((s) => `game-proof-v1/2026-11-26/b-123/${s.view}-${s.id}.jpg`));
    expect(store.objects.get(r.kept[0].key)?.meta.deleteAfter).toBe('2026-12-26T10:00:00.000Z');
  });

  it('a picture over the size cap is not stored, and says so', async () => {
    const big = jpeg(4, MAX_PICTURE_BYTES + 1);
    const s = shotFor('start', big);
    const r = await keepProofPictures({ buildId: 'b', shots: [s], read: files({ [s.path]: big }), store: memoryStore(), nowMs: NOW });
    expect(r.kept).toEqual([]);
    expect(r.notKept[0].why).toMatch(/over the 40 KB size cap/);
  });

  it('a fourth picture is over the per-build cap', async () => {
    const pics = [jpeg(1), jpeg(2), jpeg(3), jpeg(5)];
    const shots = [shotFor('start', pics[0]), shotFor('moved', pics[1]), shotFor('far', pics[2]), shotFor('far', pics[3])];
    const r = await keepProofPictures({ buildId: 'b', shots, read: files(Object.fromEntries(shots.map((s, i) => [s.path, pics[i]]))), store: memoryStore(), nowMs: NOW });
    expect(r.kept).toHaveLength(3);
    expect(r.notKept).toEqual([{ view: 'far', why: 'over the 3-picture cap for one build' }]);
  });

  it('bytes that do not hash to the id the playtest printed (a truncated or swapped file) are refused', async () => {
    const s = shotFor('start', jpeg(1));
    const r = await keepProofPictures({ buildId: 'b', shots: [s], read: files({ [s.path]: jpeg(9) }), store: memoryStore(), nowMs: NOW });
    expect(r.notKept[0].why).toMatch(/not the picture the playtest described/);
  });

  it('no bucket, the kill switch, no build id: nothing stored, each reason said', async () => {
    const s = shotFor('start', jpeg(1));
    const read = files({ [s.path]: jpeg(1) });
    expect((await keepProofPictures({ buildId: 'b', shots: [s], read, store: null })).notKept[0].why).toMatch(/no private storage bucket/);
    expect((await keepProofPictures({ buildId: 'b', shots: [s], read, store: memoryStore(), enabled: false })).notKept[0].why).toMatch(/switched off/);
    expect((await keepProofPictures({ buildId: '', shots: [s], read, store: memoryStore() })).notKept[0].why).toMatch(/no id/);
    expect(proofPictureKeepEnabled({ AGENTV3_GAME_PROOF_KEEP: 'OFF' })).toBe(false);
    expect(proofPictureKeepEnabled({})).toBe(true);
  });

  it('a store that hangs is bounded by the keep budget', async () => {
    vi.useFakeTimers();
    try {
      const s = shotFor('start', jpeg(1));
      const hang: ProofPictureStore = { ...memoryStore(), save: () => new Promise(() => {}) };
      const p = keepProofPictures({ buildId: 'b', shots: [s], read: files({ [s.path]: jpeg(1) }), store: hang });
      await vi.advanceTimersByTimeAsync(KEEP_BUDGET_MS + 10);
      expect((await p).notKept[0].why).toMatch(/ran past its 15 s budget/);
    } finally { vi.useRealTimers(); }
  });

  it('the private bucket is the existing workspace-asset bucket; with none configured there is no store', async () => {
    expect(privateProofPictureStore({})).toBeNull();
    const store = privateProofPictureStore({ WORKSPACE_ASSETS_BUCKET: 'private-assets' })!;
    await store.save('game-proof-v1/2026-11-26/b/start-aaaaaaaaaaaa.jpg', jpeg(1), { view: 'start' });
    expect(bucketCalls.names).toEqual(['private-assets']);
    expect(bucketCalls.saved[0].opts).toMatchObject({ contentType: 'image/jpeg', metadata: { cacheControl: 'private, no-store' } });
    expect(JSON.stringify(bucketCalls.saved[0].opts)).not.toMatch(/public/i);
    await expect(store.save('../escape.jpg', jpeg(1), {})).rejects.toThrow();
    await expect(store.deleteDay('workspace-assets/')).rejects.toThrow();
  });
});

describe('the sandbox read can run nothing it was not built for', () => {
  it('only the exact path shape the playtest writes reaches the shell, capped one byte past the limit', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: jpeg(1).toString('base64') }));
    const read = sandboxPictureReader(run);
    expect(await read("/tmp/nbai-playtest-proof/start-aaaaaaaaaaaa.jpg'; rm -rf / #")).toBeNull();
    expect(await read('/etc/passwd')).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(await read('/tmp/nbai-playtest-proof/far-0123456789ab.jpg')).toEqual(jpeg(1));
    expect(run).toHaveBeenCalledWith(`head -c ${MAX_PICTURE_BYTES + 1} '/tmp/nbai-playtest-proof/far-0123456789ab.jpg' | base64 -w0`);
    expect(await sandboxPictureReader(async () => ({ exitCode: 1, stdout: 'x' }))('/tmp/nbai-playtest-proof/far-0123456789ab.jpg')).toBeNull();
  });
});

describe('30 days: the day in the key is the expiry, swept and refused', () => {
  it('the whole 30th day is kept; the 31st is expired', () => {
    expect(proofPictureExpired('game-proof-v1/2026-10-27/b/start-aaaaaaaaaaaa.jpg', NOW)).toBe(false);
    expect(proofPictureExpired('game-proof-v1/2026-10-26/b/start-aaaaaaaaaaaa.jpg', NOW)).toBe(true);
  });

  it('the sweep deletes only the day folders past 30 days', async () => {
    const store = memoryStore();
    store.objects.set('game-proof-v1/2026-10-01/b/start-aaaaaaaaaaaa.jpg', { bytes: jpeg(1), meta: {} });
    store.objects.set('game-proof-v1/2026-11-20/b/start-aaaaaaaaaaaa.jpg', { bytes: jpeg(1), meta: {} });
    expect(await sweepExpiredProofPictures(store, NOW)).toEqual(['game-proof-v1/2026-10-01/']);
    expect([...store.objects.keys()]).toEqual(['game-proof-v1/2026-11-20/b/start-aaaaaaaaaaaa.jpg']);
  });

  it('the real bucket sweep lists the day folders and deletes the old one by prefix; throttled per instance', async () => {
    const store = privateProofPictureStore({ WORKSPACE_ASSETS_BUCKET: 'private-assets' })!;
    expect(await sweepExpiredProofPictures(store, NOW)).toEqual(['game-proof-v1/2026-10-01/']);
    expect(bucketCalls.deleted).toEqual(['game-proof-v1/2026-10-01/']);
    expect(maybeSweepProofPictures(store, NOW)).toBe(true);
    expect(maybeSweepProofPictures(store, NOW + 1000)).toBe(false);
  });
});

describe('the admin route: admin only, streamed, never a public URL', () => {
  const KEY = 'game-proof-v1/2026-11-26/b-1/start-aaaaaaaaaaaa.jpg';
  function capture(verify: (req: any, res: any, next: () => void) => void, store: ProofPictureStore | null) {
    const chains = new Map<string, Array<(req: any, res: any, next: () => void) => any>>();
    const app = { get: (path: string, ...h: any[]) => { chains.set(`GET ${path}`, h); } };
    registerGameProofPicturesAdminRoutes(app as any, verify as any, () => store);
    return async (query: Record<string, unknown>) => {
      const res = mockRes();
      const req = mockReq({ query });
      const chain = chains.get('GET /api/admin/game-proof-picture')!;
      let i = 0;
      const next = async (): Promise<void> => { const h = chain[i++]; if (h) await h(req, res, next); };
      await next();
      return res;
    };
  }
  const refuse = (_q: any, res: any) => res.status(401).json({ error: 'Admin token required.' });
  const allow = (_q: any, _r: any, next: () => void) => next();

  it('a request without the admin token is refused and nothing is read', async () => {
    const store = memoryStore();
    const read = vi.spyOn(store, 'read');
    const res = await capture(refuse, store)({ key: KEY });
    expect(res.statusCode).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it('an admin gets the JPEG bytes, not cached anywhere', async () => {
    const store = memoryStore();
    await store.save(KEY, jpeg(7), {});
    const res = await capture(allow, store)({ key: KEY });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type'] ?? res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['Cache-Control'] ?? res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.isBuffer(res.sent ?? res.body)).toBe(true);
  });

  it('invalid, expired, missing and unavailable each answer their own status', async () => {
    const store = memoryStore();
    const call = capture(allow, store);
    expect((await call({ key: 'workspace-assets/x/y' })).statusCode).toBe(400);
    expect((await call({ key: ['a', 'b'] })).statusCode).toBe(400);
    expect((await call({ key: 'game-proof-v1/2026-09-01/b/start-aaaaaaaaaaaa.jpg' })).statusCode).toBe(410);
    expect((await call({ key: KEY })).statusCode).toBe(404);
    expect((await capture(allow, null)({ key: KEY })).statusCode).toBe(503);
    const broken: ProofPictureStore = { ...memoryStore(), read: async () => { throw new Error('down'); } };
    expect((await readProofPicture(broken, KEY, NOW)).kind).toBe('unavailable');
  });

  it('admin.ts registers the route behind the real admin token middleware; no signed or public URL anywhere', () => {
    const admin = readFileSync(join(__dirname, '..', 'src/server/routes/admin.ts'), 'utf8');
    expect(admin).toMatch(/registerGameProofPicturesAdminRoutes\(app, verifyAdminToken\)/);
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/gameProofPictures.ts'), 'utf8')
      + readFileSync(join(__dirname, '..', 'src/server/routes/gameProofPicturesAdmin.ts'), 'utf8');
    expect(src).not.toMatch(/getSignedUrl|makePublic|publicUrl|predefinedAcl/);
  });
});

describe('the report carries the stored ids, and the admin view reads them', () => {
  const pics = [jpeg(1), jpeg(2)];
  const shots = [shotFor('start', pics[0]), shotFor('moved', pics[1])];

  it('GAME_PROOF names each kept picture by its key and says 30 days, admin only', async () => {
    const kept = await keepProofPictures({ buildId: 'b-9', shots, read: files({ [shots[0].path]: pics[0] }), store: memoryStore(), nowMs: NOW });
    const issue = gameProofIssue(gameProof({ contract: null, run: { ok: true, proofShots: shots }, ranMs: 1000, files: {}, kept }));
    const detail = JSON.parse(issue.detail);
    expect(detail.looks.taken[0].stored).toBe(`game-proof-v1/2026-11-26/b-9/start-${shots[0].id}.jpg`);
    expect(detail.looks.taken[1].stored).toBeUndefined();
    expect(issue.message).toMatch(/1 of 2 picture\(s\) kept privately for 30 days, visible to the admin only; not kept: moved — it could not be read from the sandbox/);
    expect(isProofPictureKey(detail.looks.taken[0].stored)).toBe(true);
    // The admin view reads exactly those keys from the stored report.
    expect(proofPicturesFromIssues([issue])).toEqual([{ view: 'start', key: detail.looks.taken[0].stored }]);
    const answer = readWorkspaceReports(200, { latest: { ok: true, issues: [issue] }, history: [] });
    expect(answer.kind === 'found' && answer.latest?.proofPictures).toEqual([{ view: 'start', key: detail.looks.taken[0].stored }]);
  });

  it('without a keeper the old sentence stands; nothing kept says why', () => {
    expect(gameProofIssue(gameProof({ contract: null, run: { ok: true, proofShots: shots }, ranMs: 1, files: {} })).message).toMatch(/stay in the sandbox for this build only/);
    const none = gameProofIssue(gameProof({ contract: null, run: { ok: true, proofShots: shots }, ranMs: 1, files: {}, kept: { kept: [], notKept: [{ view: 'start', why: 'no private storage bucket is configured on this server' }], retainDays: 30 } }));
    expect(none.message).toMatch(/not kept \(start — no private storage bucket is configured on this server\), so they stay in the sandbox/);
  });

  it('the build phase copies the played pictures and GAME_PROOF records the keys', async () => {
    const issues: PlaytestIssue[] = [];
    const keep = vi.fn(async (s: ProofShot[]) => keepProofPictures({ buildId: 'b-7', shots: s, read: files({ [shots[0].path]: pics[0], [shots[1].path]: pics[1] }), store: memoryStore(), nowMs: NOW }));
    await runGamePlaytestPhase({
      facts: { enabled: true, buildOk: true, isCanvasGame: true, isImportTurn: false, aborted: false, hasRunCommand: true, hasPreviewUrl: true, awaitsShell: false, platformDone: false, timeLeft: true },
      files: {}, contract: null,
      play: async () => ({ stdout: PLAYTEST_RESULT_MARKER + JSON.stringify({ ok: true, idle: 0.1, moves: [], fps: 30, proofShots: [...shots, { view: 'far', error: 'x' }] }) }),
      readFile: async () => null, record: (i) => issues.push(i), previousIssues: async () => [], versions: async () => [], turnStartedAt: NOW,
      fix: { fixTurn: false, record: () => {}, say: () => {} } as any, keepPictures: keep,
    });
    expect(keep).toHaveBeenCalledWith(shots);
    const proof = JSON.parse(issues.find((i) => i.code === 'GAME_PROOF')!.detail!);
    expect(proof.looks.taken.map((t: { stored?: string }) => t.stored)).toEqual(shots.map((s) => `game-proof-v1/2026-11-26/b-7/${s.view}-${s.id}.jpg`));
  });

  it('the build route hands the phase the keeper (a helper call only)', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/keepPictures: gameProofKeeper\(\{ buildId, run: /);
    expect(typeof gameProofKeeper({ buildId: 'b', run: undefined })).toBe('function');
  });

  it('the admin view says a refused picture plainly', () => {
    expect(proofPictureError(410, null)).toBe('Deleted after 30 days.');
    expect(proofPictureError(503, { error: 'The private picture store could not be read right now.' })).toMatch(/could not be read/);
    expect(proofPicturesFromIssues([{ code: 'GAME_PROOF', detail: '{"looks":{"taken":[{"view":"start","stored":"https://evil/x.jpg"}]}}' }])).toEqual([]);
  });
});
