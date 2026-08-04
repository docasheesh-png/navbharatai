import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Firebase handle the client reads the token from. currentUser is mutable per-test so we can
// exercise the signed-in and signed-out branches.
const state: { token: string | null } = { token: 'id-token-abc' };
vi.mock('./firebase', () => ({
  auth: {
    get currentUser() {
      return state.token === null ? null : { getIdToken: async () => state.token };
    },
  },
}));

import { listSecrets, saveSecret, deleteSecret } from './secretsApi';

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const errJson = (status: number, body: unknown) => ({ ok: false, status, json: async () => body }) as unknown as Response;

describe('secretsApi — always attaches the Firebase token (regression: keys never saved, admin 2026-07-21)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    state.token = 'id-token-abc';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('saveSecret sends POST with the Authorization: Bearer header and the encrypted-name/value body', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ success: true }));
    await saveSecret('user-1', 'OPENAI_API_KEY', 'sk-real');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/secrets/user-1');
    expect(init.method).toBe('POST');
    // THE bug that broke saving: this header was missing, so requireUserMatch returned 401.
    expect(init.headers.Authorization).toBe('Bearer id-token-abc');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ secret_name: 'OPENAI_API_KEY', secret_value: 'sk-real' });
  });

  it('listSecrets and deleteSecret also carry the Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(okJson([{ id: 'a', secret_name: 'X' }]));
    const list = await listSecrets('user-1');
    expect(list).toEqual([{ id: 'a', secret_name: 'X' }]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token-abc');

    fetchMock.mockResolvedValueOnce(okJson({ success: true }));
    await deleteSecret('user-1', 'sec-9');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/secrets/user-1/sec-9');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer id-token-abc');
  });

  it('surfaces the server error message on a failed save (honest failure, not a silent no-op)', async () => {
    fetchMock.mockResolvedValueOnce(errJson(500, { error: 'Failed to save secret' }));
    await expect(saveSecret('user-1', 'K', 'v')).rejects.toThrow('Failed to save secret');
  });

  it('gives a sign-in hint on 401 (no server message)', async () => {
    fetchMock.mockResolvedValueOnce(errJson(401, {}));
    await expect(saveSecret('user-1', 'K', 'v')).rejects.toThrow(/sign in again/i);
  });

  it('signed-out (no currentUser): no Authorization header — the server then honestly answers 401', async () => {
    state.token = null;
    fetchMock.mockResolvedValueOnce(okJson({ success: true }));
    await saveSecret('user-1', 'K', 'v');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('a hung/aborted request becomes a friendly timeout error, never a stuck spinner (admin: "atak jata hai")', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValueOnce(abortErr);
    await expect(saveSecret('user-1', 'K', 'v')).rejects.toThrow(/timed out/i);
  });

  it('passes an AbortSignal so the request is actually bounded', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ success: true }));
    await saveSecret('user-1', 'K', 'v');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
