import { it, expect, vi } from 'vitest';
import { assetRetryDeadline } from './assetProviderBudget';
import { syntheticCandidate, syntheticGlb } from '../../../../tests/fixtures/gameAssetFixtures';

it('honors long numeric/HTTP-date Retry-After without truncating, with fail-closed overflow', () => {
  const now=Date.UTC(2026,10,1,12);
  expect(assetRetryDeadline('3600',now)).toBe(now+3600000);
  expect(assetRetryDeadline(new Date(now+7200000).toUTCString(),now)).toBe(now+7200000);
  expect(assetRetryDeadline('9'.repeat(100),now)).toBe(Number.MAX_SAFE_INTEGER);
  expect(assetRetryDeadline(null,now)).toBe(now+60000);
  expect(assetRetryDeadline('invalid',now)).toBe(now+60000);
});
it('reserves bounded spacing, supports cancellation, and never shortens concurrent backoff', async () => {
  vi.resetModules();vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,10,1));
  try {
    const {assetProviderPermit,recordAssetProviderResponse}=await import('./assetProviderBudget');
    const signal=new AbortController().signal,origin='https://models.example';
    expect(assetProviderPermit(origin,signal)).toBeUndefined();
    const queued=assetProviderPermit(origin,signal);expect(queued).toBeInstanceOf(Promise);
    expect(()=>assetProviderPermit(origin,signal)).toThrow('rate limit');
    await vi.advanceTimersByTimeAsync(1000);await queued;
    recordAssetProviderResponse(origin,new Response('',{status:429,headers:{'retry-after':'3600'}}));
    recordAssetProviderResponse(origin,new Response('',{status:503,headers:{'retry-after':'2'}}));
    await vi.advanceTimersByTimeAsync(301000);
    expect(()=>assetProviderPermit(origin,signal)).toThrow('rate limit');
    await vi.advanceTimersByTimeAsync(3299000);
    expect(assetProviderPermit(origin,signal)).toBeUndefined();
    const controller=new AbortController();const cancelled=assetProviderPermit(origin,controller.signal);
    const assertion=expect(cancelled).rejects.toThrow('cancelled');controller.abort();await assertion;
  } finally {vi.useRealTimers();}
});
it('enforces server backoff on binary downloads before another external request', async () => {
  vi.resetModules();const {downloadGameAsset}=await import('./assetDownload');
  const candidate=syntheticCandidate(syntheticGlb());
  const fetch=vi.fn(async()=>new Response('',{status:429,headers:{'retry-after':'3600'}}));vi.stubGlobal('fetch',fetch);
  const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now);
  try {
    await expect(downloadGameAsset(candidate,new Set(candidate.downloadOrigins),new AbortController().signal)).rejects.toThrow('response rejected');
    clock.mockReturnValue(now+301000);
    await expect(downloadGameAsset(candidate,new Set(candidate.downloadOrigins),new AbortController().signal)).rejects.toThrow('rate limit');
    expect(fetch).toHaveBeenCalledOnce();
  } finally {clock.mockRestore();vi.unstubAllGlobals();}
});
