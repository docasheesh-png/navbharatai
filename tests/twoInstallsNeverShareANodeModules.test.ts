// TWO INSTALLS NEVER SHARE A node_modules (autopsy d0b2fcd6, 2026-10-07, Q-739).
//
// The import's migration step (`ensureDependencies`) and the dev-server health check both install through
// `_npmInstall`. Its "lock" only touched a marker file and never waited for anyone else's, so the two ran into
// one `node_modules` at once: `ENOTEMPTY: directory not empty, rename …/node_modules/@babel/helper-plugin-utils`
// on both attempts, and the database migration was skipped. These tests drive the real actuator method
// against a fake sandbox whose npm takes time, and count how many installs are ever running together.

import { describe, it, expect } from 'vitest';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

function fakeSandbox() {
  let running = 0;
  let peak = 0;
  const order: string[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const sandbox = {
    sandboxId: 'sbx-test',
    commands: {
      run: async (cmd: string) => {
        if (/^npm (?:ci|install)\b/.test(cmd)) {
          running += 1; peak = Math.max(peak, running); order.push(`start:${cmd}`);
          await sleep(25);
          running -= 1; order.push(`end:${cmd}`);
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    },
    files: {
      exists: async () => true,
      read: async () => '{"name":"x","dependencies":{"react":"18"}}',
      write: async () => undefined,
      list: async () => [],
    },
  };
  return { sandbox, peak: () => peak, order };
}

describe('the npm install lock', () => {
  it('🔒 two installs requested at once run one after the other — never into one node_modules together', async () => {
    const act = new E2BActuator('test-key') as unknown as { _npmInstallLocked: (s: unknown) => Promise<{ success: boolean }> };
    const f = fakeSandbox();
    const [a, b] = await Promise.all([act._npmInstallLocked(f.sandbox), act._npmInstallLocked(f.sandbox)]);
    expect(f.order.filter((o) => o.startsWith('start:')).length).toBeGreaterThanOrEqual(2);
    expect(f.peak()).toBe(1);
    expect(a.success && b.success).toBe(true);
  });

  it('a failed install does not jam the next one', async () => {
    const act = new E2BActuator('test-key') as unknown as {
      _npmInstallLocked: (s: unknown) => Promise<{ success: boolean }>;
      _npmInstallUnlocked: (s: unknown) => Promise<{ success: boolean; log: string }>;
    };
    const f = fakeSandbox();
    const real = act._npmInstallUnlocked.bind(act);
    let first = true;
    act._npmInstallUnlocked = async (s) => { if (first) { first = false; throw new Error('boom'); } return real(s); };
    await expect(act._npmInstallLocked(f.sandbox)).rejects.toThrow('boom');
    await expect(act._npmInstallLocked(f.sandbox)).resolves.toMatchObject({ success: true });
  });

  it('different sandboxes do not wait for each other', async () => {
    const act = new E2BActuator('test-key') as unknown as { _npmInstallLocked: (s: unknown) => Promise<unknown> };
    const f1 = fakeSandbox();
    const f2 = fakeSandbox();
    const t0 = Date.now();
    await Promise.all([act._npmInstallLocked(f1.sandbox), act._npmInstallLocked(f2.sandbox)]);
    expect(f1.peak()).toBe(1);
    expect(f2.peak()).toBe(1);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});
