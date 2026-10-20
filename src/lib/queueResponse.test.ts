import { describe, it, expect } from 'vitest';
import { confirmedQueueResponse, confirmedQueueClaim, confirmedEnqueue } from './queueResponse';
import { createPendingRequestIdentities } from './requestIdentity';
const item = { id: 'A', prompt: 'approved step', source: 'user', status: 'running', createdTs: 1, claimToken: 'claim-A' };
describe('queue acknowledgement loss remains an unknown outcome', () => {
  it.each([undefined, {}, { items: null }, { items: [{ ...item, status: 'unknown' }] }, { items: [], paused: 'false' }])('rejects malformed success envelopes %j', (body) => {
    expect(() => confirmedQueueResponse(body)).toThrow(/could not be confirmed/);
  });
  it('distinguishes a confirmed empty queue from a missing claim', () => {
    expect(confirmedQueueClaim({ items: [], claimed: null })).toBeNull();
    expect(() => confirmedQueueClaim({ items: [] })).toThrow(/could not be confirmed/);
    expect(confirmedQueueClaim({ items: [item], claimed: item })).toEqual(item);
  });
  it('retains enqueue identity after a malformed HTTP200, then reconciles the committed duplicate', () => {
    let serial = 0;
    const identities = createPendingRequestIdentities(() => `request-${++serial}`);
    const first = identities.begin('workspace/prompt/source');
    // The server committed, but its response body was truncated. No acknowledgement is possible.
    expect(() => confirmedEnqueue({ items: [item] })).toThrow(/could not be confirmed/);
    const retried = identities.begin('workspace/prompt/source');
    expect(retried).toBe(first);
    expect(confirmedEnqueue({ items: [item], added: false, reason: 'duplicate-id' })).toBe(true);
    identities.acknowledge('workspace/prompt/source', retried);
    expect(identities.begin('workspace/prompt/source')).not.toBe(first);
  });
  it('accepts only explicit durable enqueue outcomes', () => {
    expect(confirmedEnqueue({ items: [item], added: true })).toBe(true);
    expect(confirmedEnqueue({ items: [], added: false, reason: 'queue-full' })).toBe(false);
    expect(() => confirmedEnqueue({ items: [], added: false })).toThrow();
  });
});
