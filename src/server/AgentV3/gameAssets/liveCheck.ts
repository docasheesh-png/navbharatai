/**
 * L3 STEP 1 — does the production network let the asset engine actually download? (admin 2026-11-04: "haan, step
 * 1 se shuru karo … kuch kharab na hone paye").
 *
 * The L3 asset layer passed live downloads on GitHub's runners, but never from Cloud Run: the build sandbox that
 * developed it got EAI_AGAIN from DNS, and no production check existed. This runs, from inside the server, the
 * EXACT guarded transports a build would use — the Poly Haven metadata transport and the reviewed-asset downloader
 * (SSRF guard, exact origins, budgets, hash pinning) — and reports each stage as passed or failed, with timings.
 *
 * 🔒 SAFE BY CONSTRUCTION: it writes nothing (no cache, no bucket, no workspace), it does not read or change
 * `AGENTV3_EXTERNAL_GAME_ASSETS`, and it is admin-triggered and single-flight. Users are not affected either way.
 */
import { createHash } from 'node:crypto';
import { polyHavenTransport, downloadReviewedAsset } from './assetTransport';
import { REVIEWED_GAME_ASSETS, type ReviewedAsset } from './providers';
import { validateGlb } from './assetPolicy';

export interface LiveCheckStep { name: string; ok: boolean; ms: number; detail: string }
export interface LiveCheckResult { ok: boolean; at: number; steps: LiveCheckStep[] }

/** The reviewed asset the download step fetches: a plain network GLB, the smallest such kind of entry. */
export const LIVE_CHECK_ASSET_ID = 'fox';
export const LIVE_CHECK_SEARCH = 'https://api.polyhaven.com/search?q=table&t=models';

/** The reason in words, never a provider body: the error's own code/name and a short message. */
export function describeFailure(e: unknown): string {
  const err = e as { code?: unknown; cause?: { code?: unknown }; name?: unknown; message?: unknown } | null;
  const code = typeof err?.code === 'string' ? err.code : typeof err?.cause?.code === 'string' ? err.cause.code : null;
  const msg = typeof err?.message === 'string' ? err.message.slice(0, 160) : 'unknown error';
  return code ? `${code}: ${msg}` : msg;
}

async function step(name: string, run: () => Promise<string>): Promise<LiveCheckStep> {
  const t = Date.now();
  // Await FIRST, then read the clock: in an object literal `ms` is evaluated before `await run()`, which
  // reported every step as 0 ms (caught on the first real run).
  try { const detail = await run(); return { name, ok: true, ms: Date.now() - t, detail }; }
  catch (e) { return { name, ok: false, ms: Date.now() - t, detail: describeFailure(e) }; }
}

let running: Promise<LiveCheckResult> | null = null;

export function runGameAssetLiveCheck(deps: {
  catalogue?: readonly ReviewedAsset[];
  metadata?: { get(url: string, signal: AbortSignal): Promise<unknown> };
  download?: (c: ReviewedAsset, s: AbortSignal) => Promise<Uint8Array>;
  now?: () => number;
} = {}): Promise<LiveCheckResult> {
  if (running) return running; // single-flight: a second press waits for the same check
  const catalogue = deps.catalogue ?? REVIEWED_GAME_ASSETS;
  const metadata = deps.metadata ?? polyHavenTransport;
  const download = deps.download ?? downloadReviewedAsset;
  running = (async () => {
    const steps: LiveCheckStep[] = [];
    steps.push(await step('Poly Haven search (live discovery)', async () => {
      const body = await metadata.get(LIVE_CHECK_SEARCH, AbortSignal.timeout(15_000)) as unknown;
      // The same shape the discovery reads (polyHavenDiscovery.ts): `{ results: [...] }`.
      const results = (body as { results?: unknown } | null)?.results;
      if (!Array.isArray(results)) throw new Error('The search answered in an unexpected shape');
      const n = results.length;
      if (n === 0) throw new Error('The search answered with no results');
      return `${n} result(s)`;
    }));
    const asset = catalogue.find((a) => a.id === LIVE_CHECK_ASSET_ID && !a.packaged);
    let bytes: Uint8Array | null = null;
    steps.push(await step('Reviewed model download (GitHub raw)', async () => {
      if (!asset) throw new Error(`The reviewed catalogue has no network asset "${LIVE_CHECK_ASSET_ID}"`);
      bytes = await download(asset, AbortSignal.timeout(20_000));
      return `${bytes.byteLength} bytes from ${new URL(asset.downloadUrl).host}`;
    }));
    if (asset && bytes) {
      const got: Uint8Array = bytes;
      steps.push(await step('Hash matches the reviewed pin', async () => {
        const h = createHash('sha256').update(got).digest('hex');
        if (h !== asset.sha256) throw new Error(`sha256 ${h.slice(0, 12)}… is not the pinned ${asset.sha256.slice(0, 12)}…`);
        return `sha256 ${h.slice(0, 12)}…`;
      }));
      steps.push(await step('GLB passes the model validator', async () => {
        const v = validateGlb(got);
        return `${v.triangles} triangles, ${v.animations.length} animation(s)`;
      }));
    }
    return { ok: steps.every((s) => s.ok), at: (deps.now ?? Date.now)(), steps };
  })();
  const done = running;
  void done.finally(() => { if (running === done) running = null; }).catch(() => {});
  return done;
}
