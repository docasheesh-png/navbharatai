import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Google auth + axios so we can inspect the exact channel-create payload without a network call.
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    async getAccessToken() { return 'test-token'; }
  },
}));

vi.mock('axios', () => {
  const post = vi.fn();
  const patch = vi.fn();
  const del = vi.fn();
  const get = vi.fn();
  return { default: { post, patch, delete: del, get }, AxiosError: class AxiosError extends Error {} };
});

import axios from 'axios';
import { FirebaseHostingDeployer } from './Deployment';

/**
 * REGRESSION (2026-08-20): publishing broke with Firebase HTTP 400
 *   "Invalid JSON payload received. Unknown name \"type\" at 'channel': Cannot find field."
 * A Firebase Hosting `Channel` has NO `type` field — `type: 'LIVE'` used to be silently ignored, but
 * the API tightened to reject unknown fields, which took down the whole publish path. These tests lock
 * the create payload to ONLY valid Channel fields, and assert no expiry (so the app URL stays permanent).
 */
describe('FirebaseHostingDeployer — channel-create payload is valid (no `type`, no expiry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('/versions') && !url.includes('populateFiles')) {
        return { data: { name: 'sites/site/versions/ver1' } };
      }
      if (url.includes('populateFiles')) {
        return { data: { uploadRequiredHashes: [], uploadUrl: undefined } };
      }
      // A channel create returns the REAL url — hash and all. Constructing it is the 2026-08-20 bug.
      if (url.includes('/channels?channelId=')) {
        return { data: { url: 'https://gen-lang-client-0866594388--v3-ws-8e33e1d.web.app' } };
      }
      return { data: {} };
    });
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { url: 'https://gen-lang-client-0866594388--v3-ws-8e33e1d.web.app' },
    });
    (axios.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
  });

  const channelCallBody = () => {
    const calls = (axios.post as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
    const call = calls.find(([url]) => url.includes('/channels?channelId='));
    expect(call).toBeTruthy();
    return call![1] as Record<string, unknown>;
  };

  it('sends ONLY valid Channel fields — never `type` (the field Firebase 400s on)', async () => {
    await new FirebaseHostingDeployer().deployStatic('ws-1', new Map([['index.html', Buffer.from('<h1>hi</h1>')]]));
    const body = channelCallBody();
    expect(body).not.toHaveProperty('type');
    expect(body).toEqual({ retainedReleaseCount: 3 });
  });

  it('sets no expiry (expireTime/ttl) so the published channel is permanent', async () => {
    await new FirebaseHostingDeployer().deployStatic('ws-2', new Map([['index.html', Buffer.from('x')]]));
    const body = channelCallBody();
    expect(body).not.toHaveProperty('expireTime');
    expect(body).not.toHaveProperty('ttl');
  });
});

/**
 * REGRESSION (admin 2026-08-20): publishing died on `Error: Request failed with status code 404`.
 * `populateFiles` is a Google API CUSTOM METHOD, addressed with a COLON — the slash form we used is
 * not a route at all. It stayed hidden because the channel-create bug (#2495) threw before reaching
 * it. These tests pin every deploy URL, so the next character-level slip fails here, not in prod.
 */
describe('FirebaseHostingDeployer - the deploy URLs are exactly what the Hosting API defines', () => {
  const urls = () => (axios.post as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String((c as unknown[])[0]));

  it('THE BUG: populateFiles is addressed with a COLON, never a slash', async () => {
    await new FirebaseHostingDeployer().deployStatic('ws-url', new Map([['index.html', Buffer.from('x')]]));
    const populate = urls().find((u) => u.includes('populateFiles'));
    expect(populate).toBeTruthy();
    expect(populate).toContain(':populateFiles');
    expect(populate).not.toContain('/populateFiles');
  });

  it('the version finalize uses the documented updateMask parameter', async () => {
    await new FirebaseHostingDeployer().deployStatic('ws-mask', new Map([['index.html', Buffer.from('x')]]));
    const patch = (axios.patch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String((c as unknown[])[0]))[0];
    expect(patch).toContain('updateMask=status');
  });

  it('a failing deploy call NAMES ITS STEP and status - never a bare axios message', async () => {
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('populateFiles')) {
        throw Object.assign(new Error('Request failed with status code 404'), {
          response: { status: 404, data: { error: { message: 'not found' } } },
        });
      }
      if (url.includes('/versions')) return { data: { name: 'sites/s/versions/v1' } };
      return { data: {} };
    });
    await expect(
      new FirebaseHostingDeployer().deployStatic('ws-err', new Map([['index.html', Buffer.from('x')]])),
    ).rejects.toThrow(/file registration failed \(HTTP 404\)/);
  });

  it('a 403 on any step still points at the missing IAM role', async () => {
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('/versions') && !url.includes('populateFiles')) {
        throw Object.assign(new Error('boom'), { response: { status: 403, data: {} } });
      }
      return { data: {} };
    });
    await expect(
      new FirebaseHostingDeployer().deployStatic('ws-403', new Map([['index.html', Buffer.from('x')]])),
    ).rejects.toThrow(/Firebase Hosting Admin/);
  });
});

/**
 * REGRESSION (admin 2026-08-20, the LAST bug in the publish chain): a publish finally succeeded
 * end-to-end and the app was still "Site Not Found". The returned URL was BUILT as
 * `<site>--<channelId>.web.app`, but a preview channel lives at `SITE--CHANNEL-RANDOMHASH.web.app`
 * — a hash Firebase generates. The deploy was real; the address we handed back was not.
 */
describe('FirebaseHostingDeployer - the published URL comes FROM Firebase, never from us', () => {
  const REAL = 'https://gen-lang-client-0866594388--v3-ws-8e33e1d.web.app';

  // Own happy-path mocks: the block above deliberately leaves failing ones in place.
  beforeEach(() => {
    vi.clearAllMocks();
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('/channels?channelId=')) return { data: { url: REAL } };
      if (url.includes('populateFiles')) return { data: { uploadRequiredHashes: [], uploadUrl: undefined } };
      if (url.includes('/versions')) return { data: { name: 'sites/s/versions/v1' } };
      return { data: {} };
    });
    (axios.patch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { url: REAL } });
  });

  it('THE BUG: returns the channel url Firebase reported, hash intact', async () => {
    const url = await new FirebaseHostingDeployer()
      .deployStatic('ws-real', new Map([['index.html', Buffer.from('x')]]));
    expect(url).toBe(REAL);
    expect(url).toContain('8e33e1d'); // the hash a constructed URL could never know
  });

  it('a REDEPLOY (channel already exists, HTTP 409) looks the url up instead of guessing it', async () => {
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('/channels?channelId=')) {
        throw Object.assign(new Error('exists'), { response: { status: 409, data: {} } });
      }
      if (url.includes('/versions') && !url.includes('populateFiles')) return { data: { name: 'sites/s/versions/v1' } };
      if (url.includes('populateFiles')) return { data: { uploadRequiredHashes: [], uploadUrl: undefined } };
      return { data: {} };
    });
    const url = await new FirebaseHostingDeployer()
      .deployStatic('ws-again', new Map([['index.html', Buffer.from('x')]]));
    expect(url).toBe(REAL);
    expect((axios.get as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('no url from Firebase = an honest STOP, never a second guessed address', async () => {
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ data: {} }));
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await expect(
      new FirebaseHostingDeployer().deployStatic('ws-nourl', new Map([['index.html', Buffer.from('x')]])),
    ).rejects.toThrow(/cannot tell you where your app is live/);
  });
});
