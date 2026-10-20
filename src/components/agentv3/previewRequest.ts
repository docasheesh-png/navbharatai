import { authJsonHeaders } from '../../lib/authHeaders';

/**
 * Preview polling and wake requests need verified ownership too. Refresh once after an auth refusal
 * so an expired/missing cached token can recover, without ever weakening the server's owner check.
 * Preserve the caller's stream, signal and keepalive; a long sandbox wake has no short API timeout.
 */
export async function previewRequest(url: string, init: Omit<RequestInit, 'body'> & { body?: string }): Promise<Response> {
  const send = async (refresh: boolean): Promise<Response> => {
    const headers = new Headers(init.headers);
    // Headers.set replaces a caller's Authorization regardless of its casing.
    headers.delete('Authorization');
    for (const [name, value] of Object.entries(await authJsonHeaders(refresh))) headers.set(name, value);
    return fetch(url, { ...init, headers });
  };
  const response = await send(false);
  if (response.status !== 401 && response.status !== 403) return response;
  // Refusals precede sandbox/diagnostics work, so replaying this JSON request cannot repeat a mutation.
  await response.body?.cancel();
  return send(true);
}
