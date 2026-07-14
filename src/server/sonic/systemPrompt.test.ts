import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './SonicBridge';

describe('buildSystemPrompt — persona + voice-mode clauses', () => {
  it('uses the default NavBharatAI Voice persona when none is given', () => {
    const p = buildSystemPrompt('female');
    expect(p).toContain('NavBharatAI Voice');
  });

  it('prepends a professional persona so the professional voice IS that professional', () => {
    const persona = 'You are Doctor AI, a careful medical assistant.';
    const p = buildSystemPrompt('male', persona);
    expect(p.startsWith(persona)).toBe(true);       // persona leads
    expect(p).toContain('SPEAK LIKE A REAL HUMAN');  // voice-mode clauses appended
  });

  it('carries the gender clause matching the chosen voice', () => {
    expect(buildSystemPrompt('female', 'X')).toContain('FEMININE');
    expect(buildSystemPrompt('male', 'X')).toContain('MASCULINE');
  });

  it('keeps the no-reveal identity guard (never names the underlying provider)', () => {
    const p = buildSystemPrompt('female', 'X');
    expect(p).toContain('NEVER mention or reveal');
    expect(p).toContain('NavBharatAI');
  });
});
