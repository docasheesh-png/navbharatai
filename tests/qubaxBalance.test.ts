import { afterEach, describe, expect, it, vi } from 'vitest';
import { readQubaxBalance } from '../src/server/lib/qubaxBalance';

const env = { QUBAX_ENABLED: '1', QUBAX_API_KEY: 'synthetic-balance-key' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.restoreAllMocks());

describe('Qubax balance metadata', () => {
  it('reads the account balance and never calls chat', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ currency: 'USD', balance_micros: 1_500_000, balance_usd: 1.5 }));
    await expect(readQubaxBalance({ env, fetchImpl })).resolves.toMatchObject({ status: 'available', currency: 'USD', balanceMicros: '1500000' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.qubax.ai/v1/billing/balance');
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('/chat/completions');
  });
  it('turns an authentication failure into a fixed code and drops the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('secret-key-body', { status: 401, headers: { 'content-type': 'text/plain' } }));
    const result = await readQubaxBalance({ env, fetchImpl });
    expect(result).toEqual({ status: 'unknown', code: 'authentication' });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });
  it('does not call the network when the server switch is off', async () => {
    const fetchImpl = vi.fn();
    await expect(readQubaxBalance({ env: { QUBAX_ENABLED: '0', QUBAX_API_KEY: 'synthetic-balance-key' }, fetchImpl })).resolves.toEqual({ status: 'unknown', code: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
