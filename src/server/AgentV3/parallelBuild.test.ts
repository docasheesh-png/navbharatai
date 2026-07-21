import { describe, it, expect } from 'vitest';
import { parallelBuildEnabled, lockedActuator, PARALLEL_WRITER_ROLES } from './parallelBuild';
import { PathWriteLock } from './pathWriteLock';
import type { ActuatorPort } from './ToolDispatcher';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('parallelBuildEnabled', () => {
  it('is OFF by default, ON only for exactly "on"', () => {
    expect(parallelBuildEnabled({})).toBe(false);
    expect(parallelBuildEnabled({ AGENTV3_PARALLEL_BUILD: '' })).toBe(false);
    expect(parallelBuildEnabled({ AGENTV3_PARALLEL_BUILD: 'true' })).toBe(false);
    expect(parallelBuildEnabled({ AGENTV3_PARALLEL_BUILD: 'on' })).toBe(true);
  });
});

describe('PARALLEL_WRITER_ROLES', () => {
  it('is exactly frontend + backend (the writer roles gated behind the flag)', () => {
    expect([...PARALLEL_WRITER_ROLES].sort()).toEqual(['backend', 'frontend']);
  });
});

// A fake actuator that records writes with a small delay so we can observe serialization order.
function fakeActuator(log: string[]): ActuatorPort {
  return {
    writeFile: async (_ws: string, path: string, content: string) => {
      log.push(`${path}:start:${content}`);
      await tick(path === 'a.ts' ? 20 : 1);
      log.push(`${path}:end:${content}`);
    },
    // A representative other method — must pass through, bound to the target.
    readFile: async (_ws: string, path: string) => `contents-of-${path}`,
  } as unknown as ActuatorPort;
}

describe('lockedActuator', () => {
  it('serializes SAME-path writes in order via the lock', async () => {
    const log: string[] = [];
    const lock = new PathWriteLock();
    const act = lockedActuator(fakeActuator(log), lock);
    // two writes to the same path; first is slower — must still finish before the second starts.
    await Promise.all([act.writeFile('ws', 'a.ts', '1'), act.writeFile('ws', 'a.ts', '2')]);
    expect(log).toEqual(['a.ts:start:1', 'a.ts:end:1', 'a.ts:start:2', 'a.ts:end:2']);
  });

  it('runs DIFFERENT-path writes concurrently (the speedup path)', async () => {
    const log: string[] = [];
    const lock = new PathWriteLock();
    const act = lockedActuator(fakeActuator(log), lock);
    await Promise.all([act.writeFile('ws', 'a.ts', 'x'), act.writeFile('ws', 'b.ts', 'y')]);
    // b (faster, different key) completes before a — proof they overlapped.
    expect(log.indexOf('b.ts:end:y')).toBeLessThan(log.indexOf('a.ts:end:x'));
  });

  it('passes other methods through unchanged', async () => {
    const lock = new PathWriteLock();
    const act = lockedActuator(fakeActuator([]), lock);
    expect(await act.readFile('ws', 'x.ts')).toBe('contents-of-x.ts');
  });
});
