import { describe, it, expect } from 'vitest';
import { inferPhase, phaseGuidance, dialoguePhaseContext, type DialogueSignals } from './DialogueStateManager';

const sig = (over: Partial<DialogueSignals>): DialogueSignals => ({
  intent: 'new_build', prompt: '', hasExistingFiles: false, ...over,
});

describe('inferPhase — "production-<quality>" must NOT be read as a deploy request (ShopSphere App #12)', () => {
  it('the EXACT ShopSphere ending "Production-clean, mobile-responsive" → building, NOT deployed', () => {
    const p = inferPhase(sig({ prompt: 'Build ShopSphere, a multi-vendor marketplace. Production-clean, mobile-responsive, no placeholder buttons.' }));
    expect(p).toBe('building');
  });

  it('other quality compounds are also not deploy signals', () => {
    for (const q of ['production-ready', 'production ready', 'production-grade', 'production quality', 'production-worthy']) {
      expect(inferPhase(sig({ prompt: `Build a real, ${q} SaaS dashboard` }))).toBe('building');
    }
  });

  it('a REAL deploy request is still DEPLOYED', () => {
    for (const d of ['deploy it', 'publish my app', 'go live', 'ship it', 'make it live', 'deploy to production', 'host it for me']) {
      expect(inferPhase(sig({ prompt: d, hasExistingFiles: true, intent: 'edit_existing' }))).toBe('deployed');
    }
  });

  it('bare "in production" still reads as deploy (only the quality compounds are excluded)', () => {
    expect(inferPhase(sig({ prompt: 'is this running in production yet?', hasExistingFiles: true, intent: 'edit_existing' }))).toBe('deployed');
  });
});

describe('inferPhase — the other phases still classify correctly', () => {
  it('a broken-report follow-up on an existing project → debugging', () => {
    expect(inferPhase(sig({ prompt: 'the login button does nothing', hasExistingFiles: true, intent: 'edit_existing' }))).toBe('debugging');
  });
  it('plan-mode fresh build → planning', () => {
    expect(inferPhase(sig({ prompt: 'build a big CRM', planning: true }))).toBe('planning');
  });
  it('a very short vague first ask → requirements', () => {
    expect(inferPhase(sig({ prompt: 'an app' }))).toBe('requirements');
  });
  it('a normal fresh build → building', () => {
    expect(inferPhase(sig({ prompt: 'build a notes app with tags and search' }))).toBe('building');
  });
  it('deployed phase carries the DEPLOY/SHIP guidance; building carries none', () => {
    expect(phaseGuidance('deployed')).toContain('DEPLOY/SHIP');
    expect(phaseGuidance('building')).toBe('');
    expect(dialoguePhaseContext(sig({ prompt: 'Build a production-clean multi-vendor marketplace with carts' })).phase).toBe('building');
  });
});
