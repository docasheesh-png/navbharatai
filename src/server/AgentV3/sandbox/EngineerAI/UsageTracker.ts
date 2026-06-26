/**
 * Phase 12E — lightweight in-memory usage tracking for cost control.
 *
 * Tracks per-workspace counts of the operations that drive E2B + Grok cost
 * (sandbox creations, commands, builds, screenshots) plus first/last activity.
 * In-memory only (resets on server restart) — enough for surfacing live usage to
 * the user and powering idle-cleanup decisions without a database dependency.
 */
export type UsageKind = 'sandbox' | 'command' | 'build' | 'screenshot' | 'aiCall';

export interface Usage {
  sandboxCreations: number;
  commands: number;
  builds: number;
  screenshots: number;
  aiCalls: number;
  firstAt: number;
  lastAt: number;
}

const FIELD: Record<UsageKind, keyof Usage> = {
  sandbox: 'sandboxCreations',
  command: 'commands',
  build: 'builds',
  screenshot: 'screenshots',
  aiCall: 'aiCalls',
};

class UsageTracker {
  private map = new Map<string, Usage>();

  record(workspaceId: string, kind: UsageKind): void {
    if (!workspaceId) return;
    const now = Date.now();
    let u = this.map.get(workspaceId);
    if (!u) {
      u = { sandboxCreations: 0, commands: 0, builds: 0, screenshots: 0, aiCalls: 0, firstAt: now, lastAt: now };
      this.map.set(workspaceId, u);
    }
    (u[FIELD[kind]] as number)++;
    u.lastAt = now;
  }

  get(workspaceId: string): Usage | null {
    return this.map.get(workspaceId) ?? null;
  }

  /** Clear a workspace's counters (e.g. when its sandbox is disposed). */
  clear(workspaceId: string): void {
    this.map.delete(workspaceId);
  }
}

// Singleton shared by the actuator (records) and the route (reads).
export const usageTracker = new UsageTracker();
