import { describe, it, expect } from 'vitest';
import {
  updateApnapanProfile,
  APNAPAN_DEFAULT_PROFILE,
  type ApnapanProfile,
} from '../src/lib/apnapanEngine';

function blank(): ApnapanProfile {
  return { ...APNAPAN_DEFAULT_PROFILE, greetingFrequency: {}, topics: [], projects: [] };
}

describe('updateApnapanProfile — interaction counter', () => {
  it('increments interactionCount on every call', () => {
    const p1 = updateApnapanProfile('hello', blank());
    expect(p1.interactionCount).toBe(1);
    const p2 = updateApnapanProfile('hello again', p1);
    expect(p2.interactionCount).toBe(2);
  });
});

describe('updateApnapanProfile — greeting detection', () => {
  it('detects namaste and sets preferredGreeting', () => {
    const result = updateApnapanProfile('namaste, how are you?', blank());
    expect(result.preferredGreeting).toBe('नमस्ते');
    expect(result.greetingFrequency['नमस्ते']).toBe(1);
  });

  it('detects namaste in mixed Hinglish (Latin chars allow \\b match)', () => {
    const result = updateApnapanProfile('namaste bhai how are you', blank());
    expect(result.preferredGreeting).toBe('नमस्ते');
  });

  it('detects hello', () => {
    const result = updateApnapanProfile('Hello there', blank());
    expect(result.preferredGreeting).toBe('Hello');
  });

  it('detects ram ram', () => {
    const result = updateApnapanProfile('Ram Ram ji', blank());
    expect(result.preferredGreeting).toBe('राम-राम');
  });

  it('preferred greeting is the most frequent one', () => {
    let p = blank();
    p = updateApnapanProfile('namaste', p);
    p = updateApnapanProfile('namaste', p);
    p = updateApnapanProfile('hello', p);
    expect(p.preferredGreeting).toBe('नमस्ते');
  });

  it('no greeting → preferredGreeting remains null', () => {
    const result = updateApnapanProfile('build me an app', blank());
    expect(result.preferredGreeting).toBeNull();
  });
});

describe('updateApnapanProfile — language detection', () => {
  it('detects pure Hindi (Devanagari with few Latin words)', () => {
    const result = updateApnapanProfile('मुझे एक वेबसाइट बनानी है', blank());
    expect(result.preferredLanguage).toBe('Hindi');
  });

  it('detects Hinglish (Devanagari + many Latin words)', () => {
    const result = updateApnapanProfile('मुझे app banana hai with React', blank());
    expect(result.preferredLanguage).toBe('Hinglish');
  });

  it('detects English (no Devanagari, no South Asian)', () => {
    const result = updateApnapanProfile('build me a todo app', blank());
    expect(result.preferredLanguage).toBe('English');
  });
});

describe('updateApnapanProfile — conversation style', () => {
  it('detects professional style from doctor/dr. markers', () => {
    const result = updateApnapanProfile('doctor sahab mujhe help chahiye', blank());
    expect(result.conversationStyle).toBe('professional');
  });

  it('detects formal style from aap/sir markers', () => {
    const result = updateApnapanProfile('aap mujhe guide karein sir', blank());
    expect(result.conversationStyle).toBe('formal');
  });

  it('detects friendly style from yaar/bhai markers', () => {
    const result = updateApnapanProfile('yaar ek baat batao', blank());
    expect(result.conversationStyle).toBe('friendly');
  });

  it('professional overrides friendly when both present', () => {
    const result = updateApnapanProfile('doctor bhai help me', blank());
    expect(result.conversationStyle).toBe('professional');
  });
});

describe('updateApnapanProfile — project keyword learning', () => {
  it('adds project keyword from message', () => {
    const result = updateApnapanProfile('I am building a hospital app', blank());
    expect(result.projects).toContain('hospital');
    expect(result.projects).toContain('app');
  });

  it('does not duplicate existing project keyword', () => {
    let p = blank();
    p = updateApnapanProfile('hospital app', p);
    p = updateApnapanProfile('hospital system', p);
    expect(p.projects.filter(k => k === 'hospital')).toHaveLength(1);
  });

  it('caps projects list at 8 entries', () => {
    let p = blank();
    const words = 'hospital clinic school startup app website project navbharatai'.split(' ');
    for (const w of words) p = updateApnapanProfile(w, p);
    expect(p.projects.length).toBeLessThanOrEqual(8);
  });
});

describe('updateApnapanProfile — immutability', () => {
  it('does not mutate the previous profile', () => {
    const prev = blank();
    const frozen = Object.freeze({ ...prev });
    const result = updateApnapanProfile('namaste', frozen as ApnapanProfile);
    expect(result).not.toBe(frozen);
    expect(result.interactionCount).toBe(1);
    expect(frozen.interactionCount).toBe(0);
  });
});
