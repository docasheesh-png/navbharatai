import { describe, it, expect } from 'vitest';
import { backstopHonestyNote, backstopNarration } from './backstopHonesty';

// T1-backstop-honesty: a gate-failed backstop delivery must never read as a clean pass. Pure.

describe('backstopHonestyNote', () => {
  it('returns null when the gate passed (nothing to warn about)', () => {
    expect(backstopHonestyNote(true)).toBeNull();
    expect(backstopHonestyNote(true, 'ignored')).toBeNull();
  });

  it('surfaces the gate reason when the backstop delivered a gate-FAILED build', () => {
    const note = backstopHonestyNote(false, 'Review found issues: missing auth; broken cart');
    expect(note).toContain('best-effort backstop');
    expect(note).toContain('Review found issues: missing auth; broken cart');
  });

  it('falls back to an honest default when no reason is given', () => {
    const note = backstopHonestyNote(false, '   ');
    expect(note).toContain('the final quality review still flagged issues');
  });
});

describe('backstopNarration', () => {
  it('is null on a pass and an honest warning on a backstop delivery', () => {
    expect(backstopNarration(true)).toBeNull();
    expect(backstopNarration(false)).toContain('build-health card');
  });
});
