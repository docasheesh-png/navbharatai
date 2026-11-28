// Q-3471 — failedbr #2523: the new-game seed ran the recipes (30.5 s), then the 3D assets (21.4 s), then the sounds
// (13.8 s), one after another: 74 s before the builder's first call. The two preparers do not need each other; they only
// shared a download origin (raw.githubusercontent.com) through a permit that refused the second waiter, and a durable
// asset index both write. Admin decision 2026-11-27, option A: the permit queues a request for up to 8 s (one request a
// second per origin unchanged), and the two run side by side.
//
// These encode the #2523 shape: on a COLD cache, a model chain and a sound chain on the same origin, at the same time,
// lose nothing; the seed reports each part's own time and that they overlapped (never a sum); and the asset index keeps
// every path when two saves interleave.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SOUND_LIBRARY } from '../src/server/AgentV3/gameAssets/soundLibraryCatalogue';
import { prepareSeedMediaSideBySide, seedMediaTimingDetail } from '../src/server/AgentV3/gameAssets/seedMedia';
import { mergeAssetIndex, type AssetIndexDoc } from '../src/server/AgentV3/WorkspaceAssetStore';

const ORIGIN = 'https://raw.githubusercontent.com';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('#2523 on a cold cache: models and sounds download side by side from one origin and none is lost', () => {
  // Six models (the #2523 seed's count) and eighteen sounds (the village build that once lost 17 of 18), all fetched from
  // raw.githubusercontent.com, every fetch taking 300 ms. Nothing is cached.
  const MODELS = 6, SOUNDS = 18, TRANSFER_MS = 300;

  const rig = () => {
    const bodies = new Map<string, Buffer>();
    const models = Array.from({ length: MODELS }, (_, i) => { const url = `${ORIGIN}/models/m${i}.glb`; bodies.set(url, Buffer.from(`glb-${i}`.repeat(50))); return url; });
    const library = Array.from({ length: SOUNDS }, (_, i) => {
      const bytes = Buffer.concat([Buffer.from('OggS'), Buffer.from(`sound-${i}`.repeat(30))]);
      const url = `${ORIGIN}/sounds/s${i}.ogg`; bodies.set(url, bytes);
      return { ...SOUND_LIBRARY[0], name: `s${i}`, core: true, words: [], loop: false, packaged: false, url, bytes: bytes.length, sha256: sha(bytes) };
    });
    const fetchedAt: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => {
      fetchedAt.push(Date.now());
      await new Promise((r) => setTimeout(r, TRANSFER_MS));
      const body = bodies.get(String(input)); return body ? new Response(body) : new Response('', { status: 404 });
    }));
    const binary = new Map<string, string>();
    const sink = {
      workspace: { writeFile: async () => {}, writeBinaryFile: async () => {}, runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
      persistence: {
        saveBinary: async (_: string, f: Record<string, string>) => { for (const [p, c] of Object.entries(f)) binary.set(p, c); },
        readBinary: async (_: string, p: string) => binary.has(p) ? Buffer.from(binary.get(p)!.split(',')[1], 'base64') : null,
        saveText: async () => {},
      },
    };
    return { models, library, fetchedAt, sink };
  };

  it('every model and every sound arrives; fetches on the origin stay one second apart; the pair takes less than the sum', async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 10, 27));
    const { downloadGameAsset } = await import('../src/server/AgentV3/gameAssets/assetDownload');
    const { prepareGameSounds } = await import('../src/server/AgentV3/gameAssets/soundSeed');
    const { models, library, fetchedAt, sink } = rig();
    const signal = new AbortController().signal;
    // The model side, exactly as assetSeed chains it: one download at a time, the next after the previous settles.
    const assets = async () => {
      const got: string[] = [];
      for (const url of models) { try { await downloadGameAsset({ downloadUrl: url }, new Set([ORIGIN]), signal); got.push(url); } catch { /* a lost model */ } }
      return got;
    };
    const sounds = () => prepareGameSounds({ prompt: 'a village game', workspaceId: 'w', workspace: sink.workspace, persistence: sink.persistence, signal, env: {}, library, store: null });
    const running = prepareSeedMediaSideBySide({ assets, sounds });
    await vi.advanceTimersByTimeAsync(120_000);
    const media = await running;
    expect(media.assets?.value).toHaveLength(MODELS);
    expect(media.sounds?.value?.prepared).toHaveLength(SOUNDS);
    expect(media.sounds?.value?.skipped).toEqual([]);
    // Politeness unchanged: exactly one fetch per item (no refusals, no retries), never two within a second.
    expect(fetchedAt).toHaveLength(MODELS + SOUNDS);
    for (let i = 1; i < fetchedAt.length; i++) expect(fetchedAt[i] - fetchedAt[i - 1]).toBeGreaterThanOrEqual(1000);
    // Overlapped: the pair's wall time is under the sum of the parts' own times.
    expect(media.wallMs).toBeLessThan(media.assets!.ms + media.sounds!.ms);
  });
});

describe('the seed reports overlapped durations truthfully', () => {
  it("#2523's parts, run together: each keeps its own time, and the pair's time together is said — never a sum", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    // Both start at 0; the sounds end at 13.8 s, the assets at 21.4 s (#2523's own measurements).
    const running = prepareSeedMediaSideBySide({
      assets: () => new Promise((r) => setTimeout(() => r({ status: 'prepared' }), 21_400)),
      sounds: () => new Promise((r) => setTimeout(() => r({ status: 'prepared' }), 13_800)),
    });
    await vi.advanceTimersByTimeAsync(21_400);
    const media = await running;
    expect(media.assets?.ms).toBe(21_400);
    expect(media.sounds?.ms).toBe(13_800);
    expect(media.wallMs).toBe(21_400);
    const detail = seedMediaTimingDetail(media, { assetsStatus: 'prepared', soundsSummary: 'prepared, 18 ready' });
    expect(detail).toBe(' · 3D assets 21.4 s (prepared) · sounds 13.8 s (prepared, 18 ready) — side by side, 21.4 s together');
    expect(detail).not.toMatch(/35\.2/); // the old sequential sum
  });

  it('a part that throws is reported as failed with its time, and never takes the other part down', async () => {
    let t = 0;
    const media = await prepareSeedMediaSideBySide({
      assets: async () => { t = 5_000; throw new Error('provider down'); },
      sounds: async () => { t = 9_000; return 'ok'; },
    }, () => t);
    expect(media.assets).toMatchObject({ failed: true });
    expect(media.sounds).toMatchObject({ failed: false, value: 'ok' });
    expect(seedMediaTimingDetail(media, { soundsSummary: 'prepared' })).toMatch(/3D assets \d+\.\d s \(failed\) · sounds \d+\.\d s \(prepared\) — side by side/);
  });

  it('only one part: no "side by side" claim; no asset step at all says "not prepared"', async () => {
    const onlySounds = await prepareSeedMediaSideBySide({ sounds: async () => 'x' }, () => 0);
    expect(seedMediaTimingDetail(onlySounds, { soundsSummary: 'none' })).toBe(' · 3D assets not prepared · sounds 0.0 s (none)');
    const onlyAssets = await prepareSeedMediaSideBySide({ assets: async () => 'x' }, () => 0);
    expect(seedMediaTimingDetail(onlyAssets, { assetsStatus: 'procedural' })).toBe(' · 3D assets 0.0 s (procedural)');
  });

  it('the parts really start together: the sounds do not wait for the assets to finish', async () => {
    const order: string[] = [];
    let releaseAssets!: () => void;
    const running = prepareSeedMediaSideBySide({
      assets: async () => { order.push('assets:start'); await new Promise<void>((r) => { releaseAssets = r; }); order.push('assets:end'); },
      sounds: async () => { order.push('sounds:start'); order.push('sounds:end'); },
    });
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['assets:start', 'sounds:start', 'sounds:end']);
    releaseAssets(); await running;
  });
});

describe('the route runs the two preparers through the side-by-side helper, after the recipes', () => {
  const SRC = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('one call starts both; neither preparer is awaited on its own any more', () => {
    expect(SRC).toContain('await prepareSeedMediaSideBySide({');
    expect(SRC).not.toMatch(/await prepareGameAssets\(/);
    expect(SRC).not.toMatch(/await prepareGameSounds\(/);
    // Still after the recipe loop (the assets need the 3D layer; the sounds import the kit's audio module).
    expect(SRC.indexOf('kitRecipesMs = Date.now() - kitStartedAt;')).toBeLessThan(SRC.indexOf('await prepareSeedMediaSideBySide({'));
    // The report's timing comes from the helper, which says what overlapped.
    expect(SRC).toContain('kitMediaDetail = seedMediaTimingDetail(media,');
  });
});

describe('the durable asset index keeps every path when two saves interleave (models and sounds save side by side)', () => {
  // A Firestore-like document whose get/set each take a turn of the event loop, so unserialised read → union → write
  // interleave exactly as two concurrent saves on one instance would.
  const fakeDoc = () => {
    let stored: { paths?: string[]; oversized?: string[] } | null = null;
    const doc: AssetIndexDoc = {
      get: async () => { await new Promise((r) => setTimeout(r, 1)); const snap = stored ? { ...stored } : null; return { exists: !!snap, data: () => snap ?? undefined }; },
      set: async (v) => { await new Promise((r) => setTimeout(r, 1)); stored = { ...(stored ?? {}), ...v }; },
    };
    return { doc, paths: () => stored?.paths ?? [] };
  };

  it('six model saves and eighteen sound saves at once: all twenty-four paths are in the index', async () => {
    const { doc, paths } = fakeDoc();
    const added = [...Array.from({ length: 6 }, (_, i) => `public/game-assets/m${i}.glb`), ...Array.from({ length: 18 }, (_, i) => `public/sfx/library/s${i}.ogg`)];
    await Promise.all(added.map((p) => mergeAssetIndex(doc, 'ws-2523', [p], [])));
    expect([...paths()].sort()).toEqual([...added].sort());
  });

  it('another workspace does not wait behind this one', async () => {
    const a = fakeDoc(), b = fakeDoc();
    await Promise.all([mergeAssetIndex(a.doc, 'ws-a', ['x'], []), mergeAssetIndex(b.doc, 'ws-b', ['y'], [])]);
    expect(a.paths()).toEqual(['x']); expect(b.paths()).toEqual(['y']);
  });
});
