import { describe, it, expect, vi } from 'vitest';
import { AuditManager } from '../src/server/AppMakerLab/mutation/AuditManager';

describe('AuditManager.log', () => {
  it('does not throw for valid inputs', () => {
    const manager = new AuditManager();
    expect(() => manager.log('tx-1', 'test message')).not.toThrow();
  });

  it('calls console.log with the transaction id', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const manager = new AuditManager();
    manager.log('tx-abc', 'something happened');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('tx-abc'));
    spy.mockRestore();
  });

  it('does not throw for empty message', () => {
    const manager = new AuditManager();
    expect(() => manager.log('tx-2', '')).not.toThrow();
  });
});
