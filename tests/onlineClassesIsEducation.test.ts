// Build 19e5f6fb: "Sonu online clases" was built as a billing app.
import { describe, it, expect } from 'vitest';
import { categoryFromWords, bestGuessPrompt } from '../src/server/AgentV3/clarityGate';

describe('online classes is an education app, not billing', () => {
  it('class words (incl. typos and Hindi) map to education', () => {
    for (const p of ['Sonu online clases', 'online classes app', 'tuition class app', 'course app for teachers', 'ऑनलाइन क्लास ऐप', 'कक्षा ऐप']) {
      expect(categoryFromWords(p)).toBe('education');
    }
  });
  it('existing categories unchanged', () => {
    expect(categoryFromWords('shop billing app')).toBe('business');
    expect(categoryFromWords('snake game')).toBe('game');
    expect(categoryFromWords('notes app')).toBe('general');
  });
  it('best-guess note no longer primes "billing app"', () => {
    const p = bestGuessPrompt('Sonu online clases', 'app');
    expect(p).not.toMatch(/ek billing app maan/);
    expect(p).toMatch(/never default to a billing/);
  });
});
