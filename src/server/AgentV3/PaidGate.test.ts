import { describe, it, expect } from 'vitest';
import { decidePaidGate } from './PaidGate';

const base = { paidPublicEnabled: true, isFreeUser: false, estimateInr: 60, overdraftInr: 20 };

describe('decidePaidGate — paid-public build gate composition', () => {
  it('flag OFF → proceed (gate-off), regardless of balance (today\'s exact behavior)', () => {
    expect(decidePaidGate({ ...base, paidPublicEnabled: false, balanceInr: -9999 }))
      .toEqual({ action: 'proceed', reason: 'gate-off' });
  });

  it('free-list user → proceed (free-list), even at a huge negative balance, without needing balance', () => {
    expect(decidePaidGate({ ...base, isFreeUser: true, balanceInr: -9999 }))
      .toEqual({ action: 'proceed', reason: 'free-list' });
    // free-list short-circuits BEFORE the balance-unknown check too
    expect(decidePaidGate({ ...base, isFreeUser: true, balanceInr: null }).reason).toBe('free-list');
  });

  it('balance UNKNOWN (null) → proceed (balance-unknown) — FAIL-OPEN on infra blip / new wallet', () => {
    expect(decidePaidGate({ ...base, balanceInr: null }))
      .toEqual({ action: 'proceed', reason: 'balance-unknown' });
  });

  it('paying user with balance ≥ estimate → proceed (covers-estimate)', () => {
    expect(decidePaidGate({ ...base, balanceInr: 100 }).action).toBe('proceed');
    expect(decidePaidGate({ ...base, balanceInr: 60 }).reason).toBe('covers-estimate');
  });

  it('0 < balance < estimate → economy with notice (paying-but-low user keeps working)', () => {
    const d = decidePaidGate({ ...base, balanceInr: 5 });
    expect(d.action).toBe('economy');
    expect(d.notice).toBeTruthy();
  });

  it('balance ≤ 0 → block with add-credits notice (no free builds at zero balance, admin 2026-07-12)', () => {
    expect(decidePaidGate({ ...base, balanceInr: 0 }).action).toBe('block');
    expect(decidePaidGate({ ...base, balanceInr: 0 }).notice).toMatch(/add credits/i);
    // the old -overdraft window is gone: any negative balance now blocks
    expect(decidePaidGate({ ...base, balanceInr: -0.01 }).action).toBe('block');
    expect(decidePaidGate({ ...base, balanceInr: -19.99 }).action).toBe('block');
    expect(decidePaidGate({ ...base, balanceInr: -20 }).action).toBe('block');
    // boundary: the smallest positive balance is still economy, exactly 0 blocks
    expect(decidePaidGate({ ...base, balanceInr: 0.01 }).action).toBe('economy');
  });
});
