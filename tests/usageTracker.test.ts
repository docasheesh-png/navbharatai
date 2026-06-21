import { describe, it, expect, afterEach } from 'vitest';
import { usageTracker } from '../src/server/EngineerAI/UsageTracker';

afterEach(() => {
  usageTracker.clear('ws-1');
  usageTracker.clear('ws-2');
});

describe('usageTracker', () => {
  it('returns null for unknown workspace', () => {
    expect(usageTracker.get('unknown-ws')).toBeNull();
  });

  it('initializes counters to 0 on first record', () => {
    usageTracker.record('ws-1', 'build');
    const u = usageTracker.get('ws-1');
    expect(u?.builds).toBe(1);
    expect(u?.commands).toBe(0);
    expect(u?.sandboxCreations).toBe(0);
  });

  it('increments the correct counter on each call', () => {
    usageTracker.record('ws-1', 'command');
    usageTracker.record('ws-1', 'command');
    usageTracker.record('ws-1', 'screenshot');
    const u = usageTracker.get('ws-1');
    expect(u?.commands).toBe(2);
    expect(u?.screenshots).toBe(1);
  });

  it('tracks separate workspaces independently', () => {
    usageTracker.record('ws-1', 'build');
    usageTracker.record('ws-2', 'aiCall');
    expect(usageTracker.get('ws-1')?.builds).toBe(1);
    expect(usageTracker.get('ws-2')?.aiCalls).toBe(1);
    expect(usageTracker.get('ws-1')?.aiCalls).toBe(0);
  });

  it('ignores record() with empty workspaceId', () => {
    usageTracker.record('', 'build');
    expect(usageTracker.get('')).toBeNull();
  });

  it('clears workspace data on clear()', () => {
    usageTracker.record('ws-1', 'sandbox');
    usageTracker.clear('ws-1');
    expect(usageTracker.get('ws-1')).toBeNull();
  });
});
