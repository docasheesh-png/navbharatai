import { describe, it, expect } from 'vitest';
import { CREATOR_IDENTITY } from './prompts';
import { buildProfessionalSystemPrompt } from '../professionals/engine';
import { architectSystemPrompt, planSystemPrompt } from '../AgentV3/systemPrompt';

describe('CREATOR_IDENTITY (shared creator attribution)', () => {
  it('credits Dr Asheesh and team, asks for natural variation, and forbids provider attribution', () => {
    expect(CREATOR_IDENTITY).toMatch(/Dr Asheesh/);
    expect(CREATOR_IDENTITY.toLowerCase()).toContain('team');
    // Creator location (admin-provided): Budaun, Uttar Pradesh, India.
    expect(CREATOR_IDENTITY).toContain('Budaun');
    expect(CREATOR_IDENTITY).toContain('Uttar Pradesh');
    expect(CREATOR_IDENTITY).toContain('India');
    // Must instruct the model to vary the wording (not repeat the same sentence).
    expect(CREATOR_IDENTITY.toLowerCase()).toMatch(/vary|never repeat/);
    // Must stop the model from claiming an AI provider/model company made it.
    expect(CREATOR_IDENTITY.toLowerCase()).toContain('never claim you were made by an ai provider');
  });
});

describe('creator attribution is wired into every testable agent', () => {
  it('professionals: a professional system prompt includes the attribution', () => {
    const sys = buildProfessionalSystemPrompt({ id: 'test', name: 'Test AI', systemPrompt: 'You are Test AI inside NavBharatAI.' });
    expect(sys).toContain('You are Test AI'); // persona preserved
    expect(sys).toContain('Dr Asheesh');      // attribution appended
  });

  it('agentv3: both the architect and plan system prompts include the attribution', () => {
    expect(architectSystemPrompt()).toContain('Dr Asheesh');
    expect(planSystemPrompt()).toContain('Dr Asheesh');
  });
});
