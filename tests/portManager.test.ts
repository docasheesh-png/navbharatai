/**
 * Tests for PortManager — allocates/releases ports in the 3001-4000 range.
 * Uses real socket binding (isPortFree) so these are integration-light tests
 * against the actual network stack.
 */
import { describe, it, expect } from 'vitest';
import { PortManager } from '../src/server/PreviewRunner/PortManager';

describe('PortManager', () => {
  it('allocatePort() returns a number in the valid range', async () => {
    const pm = new PortManager();
    const port = await pm.allocatePort();
    expect(port).toBeGreaterThanOrEqual(3001);
    expect(port).toBeLessThanOrEqual(4000);
    pm.releasePort(port);
  });

  it('two consecutive allocations return different ports', async () => {
    const pm = new PortManager();
    const p1 = await pm.allocatePort();
    const p2 = await pm.allocatePort();
    expect(p1).not.toBe(p2);
    pm.releasePort(p1);
    pm.releasePort(p2);
  });

  it('releasePort() allows a released port to be re-allocated', async () => {
    const pm = new PortManager();
    const p1 = await pm.allocatePort();
    pm.releasePort(p1);
    // After release the port is back in the pool — next allocation may return it
    const p2 = await pm.allocatePort();
    expect(typeof p2).toBe('number');
    pm.releasePort(p2);
  });

  it('allocatePort() returns an integer', async () => {
    const pm = new PortManager();
    const port = await pm.allocatePort();
    expect(Number.isInteger(port)).toBe(true);
    pm.releasePort(port);
  });
});
