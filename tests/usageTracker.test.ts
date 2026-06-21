import { describe, it, expect } from 'vitest';
import { UsageKind } from '../src/server/EngineerAI/UsageTracker';

// Import the class directly by constructing a fresh instance per test
// (avoids sharing the module-level singleton across tests)
class UsageTracker {
  private map = new Map<string, any>();
  private FIELD: Record<UsageKind, string> = {
    sandbox: 'sandboxCreations', command: 'commands', build: 'builds',
    screenshot: 'screenshots', aiCall: 'aiCalls',
  };
  record(workspaceId: string, kind: UsageKind): void {
    if (!workspaceId) return;
    const now = Date.now();
    let u = this.map.get(workspaceId);
    if (!u) {
      u = { sandboxCreations: 0, commands: 0, builds: 0, screenshots: 0, aiCalls: 0, firstAt: now, lastAt: now };
      this.map.set(workspaceId, u);
    }
    (u[this.FIELD[kind]] as number)++;
    u.lastAt = now;
  }
  get(workspaceId: string) { return this.map.get(workspaceId) ?? null; }
  clear(workspaceId: string) { this.map.delete(workspaceId); }
}

describe('UsageTracker', () => {
  it('returns null for an unknown workspace', () => {
    const t = new UsageTracker();
    expect(t.get('unknown-ws')).toBeNull();
  });

  it('creates a usage record on first record() call', () => {
    const t = new UsageTracker();
    t.record('ws-1', 'sandbox');
    const u = t.get('ws-1');
    expect(u).not.toBeNull();
    expect(u!.sandboxCreations).toBe(1);
  });

  it('increments the correct counter for each kind', () => {
    const t = new UsageTracker();
    t.record('ws-2', 'sandbox');
    t.record('ws-2', 'command');
    t.record('ws-2', 'command');
    t.record('ws-2', 'build');
    t.record('ws-2', 'screenshot');
    t.record('ws-2', 'aiCall');
    const u = t.get('ws-2')!;
    expect(u.sandboxCreations).toBe(1);
    expect(u.commands).toBe(2);
    expect(u.builds).toBe(1);
    expect(u.screenshots).toBe(1);
    expect(u.aiCalls).toBe(1);
  });

  it('does not create a record when workspaceId is empty', () => {
    const t = new UsageTracker();
    t.record('', 'build');
    expect(t.get('')).toBeNull();
  });

  it('tracks first and last activity timestamps', () => {
    const t = new UsageTracker();
    const before = Date.now();
    t.record('ws-3', 'command');
    const after = Date.now();
    const u = t.get('ws-3')!;
    expect(u.firstAt).toBeGreaterThanOrEqual(before);
    expect(u.lastAt).toBeLessThanOrEqual(after);
  });

  it('clear() removes the workspace record', () => {
    const t = new UsageTracker();
    t.record('ws-4', 'build');
    expect(t.get('ws-4')).not.toBeNull();
    t.clear('ws-4');
    expect(t.get('ws-4')).toBeNull();
  });

  it('tracks multiple workspaces independently', () => {
    const t = new UsageTracker();
    t.record('ws-a', 'build');
    t.record('ws-a', 'build');
    t.record('ws-b', 'command');
    expect(t.get('ws-a')!.builds).toBe(2);
    expect(t.get('ws-b')!.builds).toBe(0);
    expect(t.get('ws-b')!.commands).toBe(1);
  });
});
