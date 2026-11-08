import { it, expect, vi } from 'vitest';
import { syntheticGlb, syntheticCandidate } from '../../../../tests/fixtures/gameAssetFixtures';

it('deduplicates simultaneous reviewed downloads, with independent cancellation', async () => {
  vi.resetModules(); const { downloadReviewedAsset } = await import('./assetTransport');
  const bytes = syntheticGlb(), c = syntheticCandidate(bytes);
  let finish!: (r: Response) => void;
  const fetch = vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));
  vi.stubGlobal('fetch',fetch);
  try {
    const aborted = new AbortController();
    const first = downloadReviewedAsset(c,aborted.signal).catch(()=>null);
    const second = downloadReviewedAsset(c,new AbortController().signal);
    aborted.abort(); finish(new Response(bytes));
    expect(await first).toBeNull(); expect(Buffer.from(await second)).toEqual(bytes); expect(fetch).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
it('honors provider backoff and refuses other metadata origins before any fetch', async () => {
  vi.resetModules(); const { polyHavenTransport } = await import('./assetTransport');
  const fetch = vi.fn(async()=>new Response('',{status:429,headers:{'retry-after':'120'}})); vi.stubGlobal('fetch',fetch);
  try {
    const signal = new AbortController().signal;
    await expect(polyHavenTransport.get('https://api.polyhaven.com/info/tree',signal)).rejects.toThrow('unavailable');
    await expect(polyHavenTransport.get('https://api.polyhaven.com/info/tree',signal)).rejects.toThrow('rate limit');
    await expect(polyHavenTransport.get('https://metadata.google.internal/info/tree',signal)).rejects.toThrow('Unapproved');
    await expect(polyHavenTransport.get('https://private:credential@api.polyhaven.com/info/tree',signal)).rejects.toThrow('Unapproved');
    await expect(polyHavenTransport.get('https://api.polyhaven.com/info/tree#secret',signal)).rejects.toThrow('Unapproved');
    expect(fetch).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
it('loads only the reviewed packaged derivative without network or private repository credentials', async () => {
  const { downloadReviewedAsset } = await import('./assetTransport');
  const { REVIEWED_GAME_ASSETS } = await import('./providers');
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const c=REVIEWED_GAME_ASSETS.find(c=>c.id==='eagle-flying')!;
  const fetch=vi.fn(async()=>{throw Error('packaged asset must not fetch')});vi.stubGlobal('fetch',fetch);
  try {
    const bytes=await downloadReviewedAsset(c,new AbortController().signal);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(c.sha256);expect(bytes.length).toBe(2064220);
    expect(fetch).not.toHaveBeenCalled();
    await expect(downloadReviewedAsset({...c,sha256:'0'.repeat(64)},new AbortController().signal)).rejects.toThrow('Unreviewed packaged');
    expect(await readFile('Dockerfile','utf8')).toContain('COPY --from=builder /app/assets/game-models ./assets/game-models');
  } finally {vi.unstubAllGlobals()}
});
