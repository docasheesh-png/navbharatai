import { describe, it, expect } from 'vitest';
import { COMPLEX_APP_SIGNAL, isComplexAppPrompt } from './appComplexitySignals';

describe('appComplexitySignals — shared complex-app category signal', () => {
  it('matches named complex-app categories (the prompts that were mis-routed to the fast lane)', () => {
    for (const p of [
      'build a SaaS CRM',
      'make an e-commerce store',
      'a food delivery app',
      'build a social network',
      'full-stack booking system',
      'an ERP with inventory',
      'a marketplace with checkout',
      'app with authentication and a database',
      'a real-time chat app',
    ]) {
      expect(isComplexAppPrompt(p)).toBe(true);
    }
  });

  it('does NOT match genuinely simple single-purpose apps (they must stay in the fast lane)', () => {
    for (const p of ['a todo app', 'a calculator', 'a stopwatch', 'a dice roller', 'a color picker', 'a landing page']) {
      expect(isComplexAppPrompt(p)).toBe(false);
    }
  });

  it('preserves every historical RequestAnalyser.complexApp alternative (superset — no lost match)', () => {
    // These were already classified complex_app before centralization; they must still match.
    for (const p of ['full-stack app', 'a saas dashboard', 'admin panel', 'stripe payment', 'graphql backend', 'crud rest api', 'websocket app', 'multi-page site']) {
      expect(COMPLEX_APP_SIGNAL.test(p)).toBe(true);
    }
  });

  it('tolerates empty / non-string input', () => {
    expect(isComplexAppPrompt('')).toBe(false);
    expect(isComplexAppPrompt(undefined as unknown as string)).toBe(false);
  });
});
