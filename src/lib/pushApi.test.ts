import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state: { token: string | null } = { token: 'id-token-abc' };
vi.mock('./firebase', () => ({
  auth: {
    get currentUser() {
      return state.token === null ? null : { getIdToken: async () => state.token };
    },
  },
}));

import { registerDeviceToken, unregisterDeviceToken } from './pushApi';

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const errJson = (status: number) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

describe('pushApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    state.token = 'id-token-abc';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('registerDeviceToken POSTs with the Authorization header and the token/platform body', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ success: true }));
    const ok = await registerDeviceToken('user-1', 'fcm-tok', 'android');
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/push/user-1/register-token');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer id-token-abc');
    expect(JSON.parse(init.body)).toEqual({ token: 'fcm-tok', platform: 'android' });
  });

  it('registerDeviceToken returns false (never throws) on a server error', async () => {
    fetchMock.mockResolvedValueOnce(errJson(500));
    await expect(registerDeviceToken('user-1', 'fcm-tok', 'ios')).resolves.toBe(false);
  });

  it('registerDeviceToken returns false (never throws) when fetch itself rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(registerDeviceToken('user-1', 'fcm-tok', 'web')).resolves.toBe(false);
  });

  it('unregisterDeviceToken DELETEs with the token in the body', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ success: true }));
    const ok = await unregisterDeviceToken('user-1', 'fcm-tok');
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/push/user-1/register-token');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ token: 'fcm-tok' });
  });

  it('no signed-in user: no Authorization header (server honestly answers 401)', async () => {
    state.token = null;
    fetchMock.mockResolvedValueOnce(okJson({ success: true }));
    await registerDeviceToken('user-1', 'fcm-tok', 'android');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
