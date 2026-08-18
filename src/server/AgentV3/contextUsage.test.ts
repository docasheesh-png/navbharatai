import { describe, it, expect } from 'vitest';
import { describeContextUsage, shouldEmitContextUsage, type ContextUsage } from './contextUsage';
import { hasProviderLeak } from '../lib/providerRedaction';

const CLAUDE = 'claude-sonnet-4-5';   // 200k window
const GLM = 'glm-5.2';                // 128k window (conservative)
const KIMI = 'kimi-k2.7-code';        // 256k window

describe('describeContextUsage', () => {
  it('is quiet well below the threshold — a meter that always talks becomes wallpaper', () => {
    const u = describeContextUsage(20_000, CLAUDE);
    expect(u.level).toBe('ok');
    expect(u.note).toBe('');
    expect(u.pct).toBe(10);
  });

  it('warns once the chat is long, and says WHY earlier details get fuzzy', () => {
    const u = describeContextUsage(150_000, CLAUDE); // 75%
    expect(u.level).toBe('high');
    expect(u.note).toMatch(/summaris/i);
  });

  it('at critical it gives the actual fix, and reassures that the app is safe', () => {
    const u = describeContextUsage(185_000, CLAUDE); // 92%
    expect(u.level).toBe('critical');
    expect(u.note).toMatch(/new chat/i);
    expect(u.note).toMatch(/safe/i);
  });

  // An ESTIMATE on a user-facing meter is a number that LOOKS measured — the same dishonesty the
  // billing law forbids. No count => say nothing.
  it('says NOTHING when the provider reported no token count (never a guess)', () => {
    for (const bad of [0, -5, null, undefined, Number.NaN]) {
      const u = describeContextUsage(bad as number, CLAUDE);
      expect(u.pct, String(bad)).toBe(0);
      expect(u.level, String(bad)).toBe('ok');
      expect(u.note, String(bad)).toBe('');
    }
  });

  it('clamps a nonsense over-window count instead of showing 340%', () => {
    expect(describeContextUsage(9_000_000, CLAUDE).pct).toBe(100);
  });

  // The window differs per engine, so the SAME token count must land differently — otherwise the meter
  // is decorative rather than a real measurement.
  it('uses each engine\'s real window (the same tokens are fuller on a smaller one)', () => {
    const used = 100_000;
    expect(describeContextUsage(used, GLM).pct).toBeGreaterThan(describeContextUsage(used, CLAUDE).pct);
    expect(describeContextUsage(used, CLAUDE).pct).toBeGreaterThan(describeContextUsage(used, KIMI).pct);
  });

  it('an unknown engine still produces a usable reading (conservative default, never a crash)', () => {
    const u = describeContextUsage(180_000, 'some-model-we-have-never-seen');
    expect(u.pct).toBeGreaterThan(0);
    expect(u.level).toBe('critical');
  });

  // 🔒 WHITE-LABEL LAW: even the window SIZE would leak which engine ran, so nothing but a percentage
  // and plain words may cross to the user.
  it('leaks NO vendor, model or window size in anything user-facing', () => {
    for (const model of [CLAUDE, GLM, KIMI, 'gemini-2.5-pro', 'grok-4']) {
      for (const used of [10_000, 150_000, 250_000]) {
        const u = describeContextUsage(used, model);
        expect(hasProviderLeak(u.note), `${model}/${used}`).toBe(false);
        expect(u.note).not.toMatch(/\d{3,}/); // no raw token/window numbers
      }
    }
  });

  it('exposes only pct + level + note + the raw used count (no window field to leak)', () => {
    expect(Object.keys(describeContextUsage(1_000, CLAUDE)).sort()).toEqual(['level', 'note', 'pct', 'usedTokens']);
  });
});

describe('shouldEmitContextUsage — one event per meaningful change, not per turn', () => {
  const at = (pct: number, level: ContextUsage['level']): ContextUsage => ({ usedTokens: 1_000, pct, level, note: '' });

  it('sends the first real reading', () => {
    expect(shouldEmitContextUsage(null, at(12, 'ok'))).toBe(true);
  });

  it('never sends an unmeasured reading', () => {
    expect(shouldEmitContextUsage(null, { usedTokens: 0, pct: 0, level: 'ok', note: '' })).toBe(false);
  });

  it('always sends when the LEVEL changes — that is the moment the user needs to know', () => {
    expect(shouldEmitContextUsage(at(69, 'ok'), at(71, 'high'))).toBe(true);
    expect(shouldEmitContextUsage(at(87, 'high'), at(89, 'critical'))).toBe(true);
  });

  it('stays quiet for a small move inside the same level (dozens of identical updates per build)', () => {
    expect(shouldEmitContextUsage(at(30, 'ok'), at(32, 'ok'))).toBe(false);
  });

  it('sends a visible move inside the same level', () => {
    expect(shouldEmitContextUsage(at(30, 'ok'), at(38, 'ok'))).toBe(true);
  });

  it('sends when usage DROPS visibly too (compaction just freed room — that is real news)', () => {
    expect(shouldEmitContextUsage(at(80, 'high'), at(40, 'ok'))).toBe(true);
  });
});
