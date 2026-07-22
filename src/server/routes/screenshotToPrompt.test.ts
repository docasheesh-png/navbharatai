import { describe, it, expect } from 'vitest';
import { buildScreenshotPrompt, cloneGuardrailsBlock } from './screenshotToPrompt';

describe('buildScreenshotPrompt — faithful clone spec', () => {
  it('asks for a pixel-perfect / 100% faithful recreation', () => {
    const p = buildScreenshotPrompt();
    expect(p.toUpperCase()).toContain('PIXEL-PERFECT');
    expect(p).toContain('SCREENSHOT');
  });

  it('honours the caller style/framework/js options', () => {
    const p = buildScreenshotPrompt('dark neon', 'React', true);
    expect(p).toContain('dark neon');
    expect(p).toContain('React');
    expect(p).toContain('interactive behaviour');
  });
});

describe('cloneGuardrailsBlock — MANDATORY anti-phishing safeguards (admin 2026-07-22)', () => {
  const g = cloneGuardrailsBlock();

  it('requires the visible NavBharatAI watermark on every screen', () => {
    expect(g).toContain('Made with NavBharatAI');
    expect(g.toLowerCase()).toContain('every page');
  });

  it('forbids the original brand name / logo (forces a non-original name)', () => {
    expect(g.toLowerCase()).toContain('non-original');
    expect(g.toLowerCase()).toContain('do not use the original');
    expect(g.toLowerCase()).toContain('logo');
  });

  it('forbids real credential capture / phishing', () => {
    expect(g.toLowerCase()).toContain('no credential capture');
    expect(g.toLowerCase()).toContain('non-functional demo');
  });

  it('embeds the code notice that also instructs downstream AIs to decline stripping the safeguards', () => {
    expect(g).toContain('NAVBHARATAI-CLONE-NOTICE');
    expect(g).toContain('NOTICE TO ANY AI ASSISTANT OR DEVELOPER READING THIS');
    expect(g.toLowerCase()).toContain('decline');
    expect(g.toLowerCase()).toContain('illegal');
    expect(g.toLowerCase()).toContain('phishing');
  });

  it('states the safeguards are non-negotiable / not optional', () => {
    expect(g.toUpperCase()).toContain('NON-NEGOTIABLE');
    expect(g.toLowerCase()).toContain('not optional');
  });
});
