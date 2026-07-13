import { describe, it, expect } from 'vitest';
import {
  runInNoClaudeZone,
  enterNoClaudeZone,
  noClaudeZoneActive,
  claudeBlockedInZone,
  isHaikuModelId,
  NoClaudeInWeakBuildError,
} from './noClaudeZone';

describe('noClaudeZone', () => {
  it('is inactive outside any zone — Claude is allowed', () => {
    expect(noClaudeZoneActive()).toBe(false);
    expect(claudeBlockedInZone('claude-sonnet-4-6')).toBe(false);
  });

  it('activates inside runInNoClaudeZone and blocks Claude', () => {
    const blocked: (string | undefined)[] = [];
    runInNoClaudeZone({ active: true, onBlocked: (m) => blocked.push(m) }, () => {
      expect(noClaudeZoneActive()).toBe(true);
      expect(claudeBlockedInZone('claude-sonnet-4-6')).toBe(true);
    });
    expect(blocked).toEqual(['claude-sonnet-4-6']);
  });

  it('an inactive zone state does not block (paid/power build)', () => {
    runInNoClaudeZone({ active: false }, () => {
      expect(noClaudeZoneActive()).toBe(false);
      expect(claudeBlockedInZone('claude-opus-4-8')).toBe(false);
    });
  });

  it('propagates across await boundaries (a heal gate awaited deep in the build)', async () => {
    let sawActive = false;
    let sawBlocked = false;
    await runInNoClaudeZone({ active: true }, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      sawActive = noClaudeZoneActive();
      sawBlocked = claudeBlockedInZone('claude-sonnet-4-6');
    });
    expect(sawActive).toBe(true);
    expect(sawBlocked).toBe(true);
  });

  // HAIKU AMENDMENT (admin 2026-07-13): "weak module me claude ka haiku ke alawa kuch aur nahi chalna
  // chahiye, matlab sonnet ya opus never never" — Haiku is the ONE authorized Claude on weak.
  it('allows a HAIKU model through an active zone; Sonnet/Opus stay refused', () => {
    runInNoClaudeZone({ active: true }, () => {
      expect(claudeBlockedInZone('claude-haiku-4-5-20251001')).toBe(false);
      expect(claudeBlockedInZone('claude-3-5-haiku-latest')).toBe(false);
      expect(claudeBlockedInZone('claude-sonnet-4-6')).toBe(true);   // never
      expect(claudeBlockedInZone('claude-opus-4-8')).toBe(true);     // never never
      expect(claudeBlockedInZone(undefined)).toBe(true);             // unknown model → refuse (safe default)
    });
  });

  it('a Haiku pass-through never fires the onBlocked observer', () => {
    const blocked: (string | undefined)[] = [];
    runInNoClaudeZone({ active: true, onBlocked: (m) => blocked.push(m) }, () => {
      claudeBlockedInZone('claude-haiku-4-5-20251001');
      claudeBlockedInZone('claude-sonnet-4-6');
    });
    expect(blocked).toEqual(['claude-sonnet-4-6']); // only the refused Sonnet is reported
  });

  it('isHaikuModelId matches haiku ids only', () => {
    expect(isHaikuModelId('claude-haiku-4-5-20251001')).toBe(true);
    expect(isHaikuModelId('claude-3-5-haiku-latest')).toBe(true);
    expect(isHaikuModelId('claude-sonnet-4-6')).toBe(false);
    expect(isHaikuModelId('claude-opus-4-8')).toBe(false);
    expect(isHaikuModelId('glm-5.2')).toBe(false);
    expect(isHaikuModelId(undefined)).toBe(false);
    expect(isHaikuModelId(null)).toBe(false);
  });

  it('the zone does not leak to sibling async contexts', async () => {
    // A concurrent unit that never entered a zone must stay unblocked while another is inside one.
    const outside = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(noClaudeZoneActive()), 0);
    });
    await runInNoClaudeZone({ active: true }, async () => {
      await new Promise((r) => setTimeout(r, 1));
    });
    expect(await outside).toBe(false);
  });

  it('enterNoClaudeZone binds the current context without a wrapper', async () => {
    // Run in an isolated context so enterWith cannot bleed into other tests.
    await runInNoClaudeZone({ active: false }, async () => {
      enterNoClaudeZone({ active: true });
      expect(noClaudeZoneActive()).toBe(true);
      await Promise.resolve();
      expect(claudeBlockedInZone('claude-sonnet-4-6')).toBe(true);
    });
  });

  it('enterNoClaudeZone with active:false is a no-op (leaves ambient context untouched)', () => {
    // No surrounding zone → still inactive after an inactive enter.
    enterNoClaudeZone({ active: false });
    expect(noClaudeZoneActive()).toBe(false);
  });

  it('onBlocked errors never escape the guard', () => {
    runInNoClaudeZone({ active: true, onBlocked: () => { throw new Error('observer boom'); } }, () => {
      expect(() => claudeBlockedInZone('claude-sonnet-4-6')).not.toThrow();
      expect(claudeBlockedInZone('claude-sonnet-4-6')).toBe(true);
    });
  });

  it('NoClaudeInWeakBuildError carries the attempted model id', () => {
    const err = new NoClaudeInWeakBuildError('claude-sonnet-4-6');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NoClaudeInWeakBuildError');
    expect(err.attemptedModel).toBe('claude-sonnet-4-6');
    expect(err.message).toContain('claude-sonnet-4-6');
  });
});
