/**
 * Tests for AppMakerLab/repair/AutoRepairEngine — dependency-injected repair orchestrator.
 * All deps (workspaceManager, mutationEngine, generationEngine) are mocked.
 */
import { describe, it, expect, vi } from 'vitest';
import { AutoRepairEngine } from '../src/server/AppMakerLab/repair/AutoRepairEngine';
import type { BuildResult } from '../src/server/AppMakerLab/types';

function makeBuildResult(errors: string[] = []): BuildResult {
  return { success: errors.length === 0, errors: errors.map(message => ({ message })) };
}

function makeWorkspaceManager() {
  return { readFile: vi.fn(async () => '// existing content') } as any;
}

function makeMutationEngine(failMutate = false) {
  return {
    mutate: vi.fn(async () => { if (failMutate) throw new Error('mutate failed'); }),
    rollback: vi.fn(async () => {}),
    recover: vi.fn(async () => {}),
  } as any;
}

function makeGenerationEngine(patches: any[] = []) {
  return {
    generate: vi.fn(async () => patches),
    execute: vi.fn(async () => patches),
  } as any;
}

describe('AutoRepairEngine.repair — no errors', () => {
  it('returns repaired=false with 0 attempts when build result has no errors', async () => {
    const engine = new AutoRepairEngine(makeWorkspaceManager(), makeMutationEngine(), makeGenerationEngine());
    const result = await engine.repair('ws-1', makeBuildResult([]));
    expect(result.attempts).toBe(0);
    expect(result.repaired).toBe(false);
  });

  it('returns empty fixesApplied when no errors', async () => {
    const engine = new AutoRepairEngine(makeWorkspaceManager(), makeMutationEngine(), makeGenerationEngine());
    const result = await engine.repair('ws-1', makeBuildResult([]));
    expect(result.fixesApplied).toEqual([]);
  });
});

describe('AutoRepairEngine.repair — with errors and patches available', () => {
  it('returns repaired=true when generation engine returns patches', async () => {
    const engine = new AutoRepairEngine(
      makeWorkspaceManager(),
      makeMutationEngine(),
      makeGenerationEngine([{ path: 'src/fix.ts', content: 'export {}' }]),
    );
    const result = await engine.repair('ws-1', makeBuildResult(['Cannot find module "axios"']));
    expect(result.repaired).toBe(true);
  });

  it('records attempt count in result', async () => {
    const engine = new AutoRepairEngine(
      makeWorkspaceManager(),
      makeMutationEngine(),
      makeGenerationEngine([{ path: 'a.ts', content: '' }]),
    );
    const result = await engine.repair('ws-1', makeBuildResult(['build error']));
    expect(result.attempts).toBeGreaterThan(0);
  });

  it('calls mutationEngine.mutate with the generated patches', async () => {
    const mutation = makeMutationEngine();
    const engine = new AutoRepairEngine(
      makeWorkspaceManager(),
      mutation,
      makeGenerationEngine([{ path: 'src/fix.ts', content: 'export {}' }]),
    );
    await engine.repair('ws-1', makeBuildResult(['error']));
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
  });
});

describe('AutoRepairEngine.repair — generation returns no patches', () => {
  it('returns repaired=false when no patches generated', async () => {
    const engine = new AutoRepairEngine(makeWorkspaceManager(), makeMutationEngine(), makeGenerationEngine([]));
    const result = await engine.repair('ws-1', makeBuildResult(['build error']));
    expect(result.repaired).toBe(false);
  });

  it('exhausts 3 attempts when no patches returned', async () => {
    const engine = new AutoRepairEngine(makeWorkspaceManager(), makeMutationEngine(), makeGenerationEngine([]));
    const result = await engine.repair('ws-1', makeBuildResult(['err1']));
    expect(result.attempts).toBe(3);
  });
});
