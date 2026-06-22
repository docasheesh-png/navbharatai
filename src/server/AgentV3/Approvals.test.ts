import { describe, it, expect } from 'vitest';
import { awaitApproval, resolveApproval, pendingApprovalCount } from './Approvals';

describe('Approvals registry (P4)', () => {
  it('resolves true when approved', async () => {
    const p = awaitApproval('r1');
    expect(pendingApprovalCount()).toBeGreaterThanOrEqual(1);
    expect(resolveApproval('r1', true)).toBe(true);
    expect(await p).toBe(true);
  });

  it('resolves false when rejected', async () => {
    const p = awaitApproval('r2');
    resolveApproval('r2', false);
    expect(await p).toBe(false);
  });

  it('auto-denies on timeout', async () => {
    const p = awaitApproval('r3', 5);
    expect(await p).toBe(false);
  });

  it('returns false for an unknown requestId', () => {
    expect(resolveApproval('does-not-exist', true)).toBe(false);
  });

  it('clears the pending entry once resolved', async () => {
    const before = pendingApprovalCount();
    const p = awaitApproval('r4');
    resolveApproval('r4', true);
    await p;
    expect(pendingApprovalCount()).toBe(before);
  });
});
