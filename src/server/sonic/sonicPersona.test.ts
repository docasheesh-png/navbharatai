import { describe, it, expect } from 'vitest';
import { sonicPersonaFor } from './sonicPersona';
import { sdaVoiceSystemPrompt } from '../lib/clinical/sdaVoicePrompt';

describe('sonicPersonaFor — voice persona resolver (Doctor AI + registry professionals)', () => {
  it("'sda' and 'doctor' resolve to the SDA clinical voice persona", () => {
    const sda = sdaVoiceSystemPrompt();
    expect(sonicPersonaFor('sda')).toBe(sda);
    expect(sonicPersonaFor('doctor')).toBe(sda);
    expect(sonicPersonaFor('SDA')).toBe(sda);      // case-insensitive
    expect(sonicPersonaFor('  Doctor ')).toBe(sda); // trimmed
  });

  it('unknown / absent id → undefined (falls back to the default voice)', () => {
    expect(sonicPersonaFor(undefined)).toBeUndefined();
    expect(sonicPersonaFor(null)).toBeUndefined();
    expect(sonicPersonaFor('')).toBeUndefined();
    expect(sonicPersonaFor('not-a-real-professional')).toBeUndefined();
  });
});

describe('sdaVoiceSystemPrompt — clinical safety invariants + voice-safe (no text-only signals)', () => {
  const p = sdaVoiceSystemPrompt().toLowerCase();

  it('keeps the core clinical SAFETY rules (mirrors the text SDA prompt)', () => {
    expect(p).toContain('assist');                 // assist, never replace
    expect(p).toContain('never replace');
    expect(p).toContain('red flag');               // red-flags first
    expect(p).toMatch(/refer now|manage here/);    // manage-vs-refer decision
    expect(p).toContain('never fake certainty');   // honesty about uncertainty
    expect(p).toMatch(/nlem|who/);                 // affordable/essential meds
    expect(p).toContain('qualified doctor');        // doctor-facing, not patient-facing
  });

  it('is VOICE-safe: never asks for the text-only machine signals that would be read aloud', () => {
    const raw = sdaVoiceSystemPrompt();
    expect(raw).not.toContain('[CLINICAL_JSON]');
    expect(raw).not.toContain('[CASE_COMPLETE]');
    expect(raw.toLowerCase()).toContain('no markdown'); // explicitly tells it not to format for screen
  });
});
