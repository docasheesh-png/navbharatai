import { describe, it, expect, afterEach } from 'vitest';
import { sandboxStore, sandboxResumeEnabled } from './SandboxStore';

describe('SandboxStore (VITEST-safe, best-effort)', () => {
  it('never throws under VITEST (Firestore is skipped) — record/get/clear are no-ops', async () => {
    await expect(sandboxStore.record('agentv3-u1-s1', 'u1', 'sbx-abc')).resolves.toBeUndefined();
    await expect(sandboxStore.get('agentv3-u1-s1')).resolves.toBeNull();
    await expect(sandboxStore.clear('agentv3-u1-s1')).resolves.toBeUndefined();
  });

  it('get returns null for an empty workspaceId', async () => {
    expect(await sandboxStore.get('')).toBeNull();
  });

  it('the orphan-reaper operations are best-effort in exactly the same way', async () => {
    // touch/listStale/markPaused run from a periodic cost sweep, so a Firestore blip, a missing index
    // or an unconfigured environment must resolve quietly rather than surface as an unhandled
    // rejection inside a timer.
    await expect(sandboxStore.touch('agentv3-u1-s1', 'sbx-abc')).resolves.toBeUndefined();
    await expect(sandboxStore.markPaused('agentv3-u1-s1')).resolves.toBeUndefined();
    await expect(sandboxStore.listStale(Date.now() - 60_000)).resolves.toEqual([]);
  });

  it('listStale refuses a nonsense cut-off instead of asking Firestore for one', async () => {
    expect(await sandboxStore.listStale(NaN)).toEqual([]);
  });
});

describe('sandboxResumeEnabled — flag gating (default ON, A3)', () => {
  const original = process.env.AGENTV3_SANDBOX_RESUME;
  afterEach(() => {
    if (original === undefined) delete process.env.AGENTV3_SANDBOX_RESUME;
    else process.env.AGENTV3_SANDBOX_RESUME = original;
  });

  it('is ON by default (fallback-protected + own-workspace-keyed)', () => {
    expect(sandboxResumeEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(sandboxResumeEnabled({ AGENTV3_SANDBOX_RESUME: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(sandboxResumeEnabled({ AGENTV3_SANDBOX_RESUME: 'anything' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('is OFF only for the exact rollback value "off"', () => {
    expect(sandboxResumeEnabled({ AGENTV3_SANDBOX_RESUME: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(sandboxResumeEnabled({ AGENTV3_SANDBOX_RESUME: 'OFF' } as unknown as NodeJS.ProcessEnv)).toBe(true); // case-sensitive: only lowercase 'off' disables
  });
});
