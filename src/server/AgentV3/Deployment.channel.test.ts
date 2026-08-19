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
  return { default: { post, patch, delete: del }, AxiosError: class AxiosError extends Error {} };
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
      return { data: {} };
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
