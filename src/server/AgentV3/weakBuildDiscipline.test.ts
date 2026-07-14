import { describe, it, expect } from 'vitest';
import { weakBuildDisciplineBlock, weakDisciplineEnabled } from './weakBuildDiscipline';

describe('weakBuildDiscipline', () => {
  it('returns empty for a NON-weak build (paid/power path is byte-for-byte unchanged)', () => {
    expect(weakBuildDisciplineBlock(false, {} as NodeJS.ProcessEnv)).toBe('');
  });

  it('emits the core-first build order for a weak build', () => {
    const block = weakBuildDisciplineBlock(true, {} as NodeJS.ProcessEnv);
    expect(block).toContain('BUILD DISCIPLINE');
    // The three ordered steps: skeleton → core feature → nice-to-haves.
    expect(block).toContain('skeleton that COMPILES');
    expect(block).toContain('ONE core feature');
    expect(block).toContain('secondary / nice-to-have');
    // Prefer-working-core and stop-when-low rules.
    expect(block).toContain('SMALLER app that fully works');
    expect(block).toContain('STOP adding new features');
    // Reinforces the App #12 class at the tier that needs it most.
    expect(block).toContain('server-only Node libraries');
  });

  it('is disabled by the AGENTV3_WEAK_DISCIPLINE=off kill switch', () => {
    expect(weakBuildDisciplineBlock(true, { AGENTV3_WEAK_DISCIPLINE: 'off' } as unknown as NodeJS.ProcessEnv)).toBe('');
  });

  it('weakDisciplineEnabled defaults ON and only "off" disables it', () => {
    expect(weakDisciplineEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(weakDisciplineEnabled({ AGENTV3_WEAK_DISCIPLINE: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(weakDisciplineEnabled({ AGENTV3_WEAK_DISCIPLINE: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
