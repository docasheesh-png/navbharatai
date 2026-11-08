import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAUSE_FAILURE_WARNING_THRESHOLD, sandboxesToReap } from '../src/server/AgentV3/sandboxReaper';

// Executable provider-failure and async-race coverage lives in sandboxSweepSafety.test.ts.
// These checks retain the pure eligibility contract and guard both sweep call sites.
describe('unconfirmed pauses remain eligible rather than being declared finished', () => {
  const now = 10_000_000;
  const stale = { workspaceId: 'w', sandboxId: 's', updatedAt: now - 60 * 60_000 };

  it('a failure count is diagnostic, never evidence that a sandbox stopped', () => {
    expect(PAUSE_FAILURE_WARNING_THRESHOLD).toBe(3);
    for (const failures of [1, 2, 3, 100, Number.NaN]) {
      const unconfirmed = { ...stale, failures };
      expect(sandboxesToReap([unconfirmed], now)).toHaveLength(1);
    }
  });

  it('only a confirmed pause newer than the last use retires a record', () => {
    expect(sandboxesToReap([stale], now)).toHaveLength(1);
    expect(sandboxesToReap([{ ...stale, pausedAt: now - 30 * 60_000 }], now)).toHaveLength(0);
    expect(sandboxesToReap([{ ...stale, pausedAt: stale.updatedAt - 1 }], now)).toHaveLength(1);
  });
});

describe('both automatic sweeps use truthful conditional settlement', () => {
  const src = readFileSync(new URL('../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', import.meta.url), 'utf8');
  const idleAt = src.indexOf('private async _sweepIdleSandboxes(');
  const orphanAt = src.indexOf('private async _sweepOrphanSandboxes(');
  const idle = src.slice(idleAt, orphanAt);
  const orphan = src.slice(orphanAt, src.indexOf('private _touchDurable(', orphanAt));

  it.each([['idle', idle], ['orphan', orphan]])('%s sweep captures pause success and uses conditional settlement', (_name, body) => {
    expect(body).toMatch(/const paused = await this\.pauseSandbox\(/);
    expect(body).toContain('if (paused)');
    expect(body).toContain('sandboxStore.markPausedIfUnchanged(');
    expect(body).not.toContain('sandboxStore.markPaused(');
    expect(body).not.toContain('killSandbox(');
  });

  it('pause reference cleanup compares the original object, not just the reused sandbox id', () => {
    const start = src.indexOf('async pauseSandbox(');
    const body = src.slice(start, src.indexOf('async killSandbox(', start));
    expect(body).toContain('} finally {');
    expect(body).toMatch(/this\.sandboxes\.get\(wid\) === sb/);
    expect(body).toContain('this._dropSandbox(wid)');
  });
});
