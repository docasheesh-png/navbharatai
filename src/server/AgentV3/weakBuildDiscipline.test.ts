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

  it('states the first-pass correctness & quality bar (the piano-autopsy weak-tier defects)', () => {
    const block = weakBuildDisciplineBlock(true, {} as NodeJS.ProcessEnv);
    expect(block).toContain('CORRECTNESS & QUALITY BAR');
    // Type errors shipped by the weak model → type-safe, no `any` escape hatch.
    expect(block).toContain('TYPE-SAFE');
    expect(block).toContain('any');
    // Empty catch block flagged but never repaired on the free/cheap tier.
    expect(block).toContain('NEVER swallow an error');
    expect(block).toContain('catch');
    // Missing accessible names on icon-only controls.
    expect(block).toContain('aria-label');
  });

  it('the quality bar is also gated by the same weak-only + kill-switch rules', () => {
    // Non-weak builds never see it, and the kill switch removes the whole block (bar included).
    expect(weakBuildDisciplineBlock(false, {} as NodeJS.ProcessEnv)).not.toContain('CORRECTNESS & QUALITY BAR');
    expect(
      weakBuildDisciplineBlock(true, { AGENTV3_WEAK_DISCIPLINE: 'off' } as unknown as NodeJS.ProcessEnv),
    ).not.toContain('CORRECTNESS & QUALITY BAR');
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
