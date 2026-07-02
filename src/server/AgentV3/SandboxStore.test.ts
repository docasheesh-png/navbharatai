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
});

describe('sandboxResumeEnabled — flag gating (default OFF)', () => {
  const original = process.env.AGENTV3_SANDBOX_RESUME;
  afterEach(() => {
    if (original === undefined) delete process.env.AGENTV3_SANDBOX_RESUME;
    else process.env.AGENTV3_SANDBOX_RESUME = original;
  });

  it('is OFF by default', () => {
    expect(sandboxResumeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(sandboxResumeEnabled({ AGENTV3_SANDBOX_RESUME: 'false' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is ON only for the exact value "on"', () => {
    expect(sandboxResumeEnabled({ AGENTV3_SANDBOX_RESUME: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(sandboxResumeEnabled({ AGENTV3_SANDBOX_RESUME: 'ON' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(sandboxResumeEnabled({ AGENTV3_SANDBOX_RESUME: '1' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
