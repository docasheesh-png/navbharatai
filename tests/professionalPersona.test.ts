/**
 * Shared professional persona layer (admin 2026-07-09) — regression lock.
 *
 * Every config-driven professional must feel like a real practitioner (consult-first,
 * field vocabulary, structured advice, conversation memory) — the layer is defined ONCE
 * in professionals/engine.ts and injected into every built system prompt, so it can
 * never drift per-config or be silently dropped.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProfessionalSystemPrompt,
  PROFESSIONAL_PERSONA_LAYER,
} from '../src/server/professionals/engine';

describe('PROFESSIONAL_PERSONA_LAYER', () => {
  it('encodes the consult-like behaviours that make a professional feel real', () => {
    const layer = PROFESSIONAL_PERSONA_LAYER.toLowerCase();
    expect(layer).toContain('clarifying questions');     // consult, don't just answer
    expect(layer).toContain('practitioner');             // speak like the field
    expect(layer).toContain('recommendation');           // structured advice
    expect(layer).toContain('refer back');               // conversation memory
    expect(layer).toContain('outside your scope');       // professional honesty
    expect(layer).toMatch(/hindi|user's language/);      // language mirroring
  });

  it('is injected into every professional system prompt, between persona and disclaimer', () => {
    const sys = buildProfessionalSystemPrompt({
      id: 'test_ai',
      name: 'Test AI',
      systemPrompt: 'You are Test AI inside NavBharatAI.',
      disclaimer: 'Test disclaimer text.',
    });
    const personaIdx = sys.indexOf('You are Test AI');
    const layerIdx = sys.indexOf('HOW TO BEHAVE LIKE A REAL PROFESSIONAL');
    const disclaimerIdx = sys.indexOf('Test disclaimer text.');
    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(layerIdx).toBeGreaterThan(personaIdx);        // layer sits on top of the persona
    expect(disclaimerIdx).toBeGreaterThan(layerIdx);     // disclaimer follows the layer
    expect(sys).toContain('Dr Asheesh');                 // attribution still appended last
  });

  it('does not interrogate on simple questions (the layer must say so explicitly)', () => {
    expect(PROFESSIONAL_PERSONA_LAYER).toMatch(/answer directly|do not interrogate/i);
  });
});
