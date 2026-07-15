import { describe, it, expect } from 'vitest';
import { AppContextInjector } from '../src/server/AppContext/AppContextInjector';

describe('AppContextInjector.getRelevantContext', () => {
  it('returns empty string for empty message', () => {
    expect(AppContextInjector.getRelevantContext('')).toBe('');
  });

  it('returns non-empty context for a settings navigation question', () => {
    const ctx = AppContextInjector.getRelevantContext('where is the settings page?');
    // Should match something in the knowledge base
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThanOrEqual(0);
  });

  it('returns non-empty full summary for whole-app question', () => {
    const ctx = AppContextInjector.getRelevantContext('what can this app do');
    expect(ctx.length).toBeGreaterThan(0);
  });
});

describe('AppContextInjector.getSurfaceFeatures', () => {
  it('returns an array for engineer_ai surface', () => {
    const features = AppContextInjector.getSurfaceFeatures('engineer_ai');
    expect(Array.isArray(features)).toBe(true);
  });

  it('returns empty array for unknown surface', () => {
    const features = AppContextInjector.getSurfaceFeatures('nonexistent_surface');
    expect(features).toHaveLength(0);
  });
});

describe('AppContextInjector.getFeatureById', () => {
  it('returns null for unknown id', () => {
    expect(AppContextInjector.getFeatureById('nonexistent-feature')).toBeNull();
  });
});

describe('AppContextInjector.getFullSummary', () => {
  it('returns a non-empty string with all features', () => {
    const summary = AppContextInjector.getFullSummary();
    expect(summary.length).toBeGreaterThan(0);
  });
});

describe('AppContextInjector.getSupportOffer', () => {
  it('offers the support email on a CORE problem signal on any surface', () => {
    for (const surface of ['nbi_chat', 'pro_chat', 'sda_chat', 'engineer_ai', 'professional', undefined]) {
      const out = AppContextInjector.getSupportOffer('I need a refund, please help', surface as any);
      expect(out).toContain('info@navbharatai.com');
    }
  });

  it('offers the support email on a Hinglish CORE signal (shikayat / madad)', () => {
    expect(AppContextInjector.getSupportOffer('mujhe shikayat karni hai')).toContain('info@navbharatai.com');
    expect(AppContextInjector.getSupportOffer('login nahi ho raha, madad chahiye', 'sda_chat')).toContain('info@navbharatai.com');
  });

  it('offers on a TECH-failure signal for general chats', () => {
    expect(AppContextInjector.getSupportOffer('the app is not working', 'nbi_chat')).toContain('info@navbharatai.com');
    expect(AppContextInjector.getSupportOffer('app crash ho raha hai', 'pro_chat')).toContain('info@navbharatai.com');
  });

  it('does NOT fire a TECH-failure signal on domain AIs (Doctor/Engineer/Professionals)', () => {
    // "kaam nahi kar raha" is the AI's own subject there (a medicine, a build) — must stay clean.
    expect(AppContextInjector.getSupportOffer('meri dawai kaam nahi kar rahi', 'sda_chat')).toBe('');
    expect(AppContextInjector.getSupportOffer('this build error aa raha hai', 'engineer_ai')).toBe('');
    expect(AppContextInjector.getSupportOffer('meri fasal kaam nahi kar rahi', 'professional')).toBe('');
  });

  it('returns empty for a normal non-problem message', () => {
    expect(AppContextInjector.getSupportOffer('what is the capital of India?', 'nbi_chat')).toBe('');
    expect(AppContextInjector.getSupportOffer('', 'nbi_chat')).toBe('');
  });

  it('getRelevantContext appends the support offer to a problem message', () => {
    const ctx = AppContextInjector.getRelevantContext('payment failed and I was charged twice', 'nbi_chat');
    expect(ctx).toContain('info@navbharatai.com');
  });
});
