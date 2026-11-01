import { it, expect, vi } from 'vitest';
import { syntheticGlb, syntheticCandidate } from './assetFixtures.testSupport';

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
    expect(fetch).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
