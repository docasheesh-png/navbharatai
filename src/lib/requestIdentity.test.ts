import { describe, it, expect } from 'vitest';
import { newRequestIdentity } from './requestIdentity';
describe('request identities on supported WebViews', () => {
  it('uses the native UUID when available', () => {
    expect(newRequestIdentity({ randomUUID: () => '12345678-1234-4234-8234-123456789abc' } as never)).toBe('12345678-1234-4234-8234-123456789abc');
  });
  it('uses secure random bytes when randomUUID is missing', () => {
    const source = { getRandomValues: (bytes: Uint8Array) => { bytes.fill(0xff); return bytes; } };
    expect(newRequestIdentity(source as never)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
  it('keeps legacy requests available when secure randomness is unavailable', () => {
    expect(newRequestIdentity({} as never)).toBeUndefined();
    expect(newRequestIdentity({ getRandomValues: () => { throw Error('unavailable'); } } as never)).toBeUndefined();
  });
});

describe('unknown build outcomes retain the logical submission identity', () => {
  it('an identical transport/manual retry reuses the UUID until terminal acknowledgement', async () => {
    const { createPendingRequestIdentities } = await import('./requestIdentity');
    let sequence = 0;
    const ids = createPendingRequestIdentities(() => `request-${++sequence}`);
    const input = JSON.stringify({ sessionId: 'A', prompt: 'Build the app', powerLevel: 'mini' });
    const first = ids.begin(input);
    // Dropped connection, unavailable progress, or no terminal event: do not acknowledge.
    expect(ids.begin(input)).toBe(first);
    // A changed session or execution input is a different logical turn.
    expect(ids.begin(JSON.stringify({ sessionId: 'B', prompt: 'Build the app', powerLevel: 'mini' }))).not.toBe(first);
    ids.acknowledge(input, first);
    expect(ids.begin(input)).not.toBe(first);
  });
  it('an old completion cannot discard a newer explicit identity for the same input', async () => {
    const { createPendingRequestIdentities } = await import('./requestIdentity');
    const ids = createPendingRequestIdentities(() => 'generated');
    ids.begin('input', 'attempt-A');
    ids.begin('input', 'attempt-B');
    ids.acknowledge('input', 'attempt-A');
    expect(ids.begin('input')).toBe('attempt-B');
  });
});
