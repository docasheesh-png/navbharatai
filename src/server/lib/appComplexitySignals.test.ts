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

  describe('page-scoped deliverables — a category THEME never makes one page "complex" (the 29-min bug)', () => {
    it('the EXACT mis-routed prompt: "SaaS landing page" is a landing page, not a SaaS platform', () => {
      // Real build report 2026-07-06: this prompt scored complex_app via `saas` → sonnet tier →
      // multi-agent blueprint path → 148 steps / 29 min / died at the wall clock. It is ONE page.
      const p = 'Make a modern SaaS landing page: sticky navbar with logo + links, a hero section with a headline, subtext and two buttons, a 3-card features row, a pricing section with 3 tiers, and a footer. Clean, responsive, dark theme.';
      expect(isComplexAppPrompt(p)).toBe(false);
    });

    it('other theme-on-a-page prompts stay simple too', () => {
      for (const p of ['an e-commerce landing page', 'CRM portfolio website', 'a coming-soon page for my marketplace', 'social app splash page']) {
        expect(isComplexAppPrompt(p)).toBe(false);
      }
    });

    it('a page ask with REAL build-scope work stays complex (scope words are never discounted)', () => {
      for (const p of [
        'SaaS landing page with login system and stripe checkout',
        'landing page with authentication and a database',
        'e-commerce landing page plus a full backend rest api',
      ]) {
        expect(isComplexAppPrompt(p)).toBe(true);
      }
    });

    it('non-page SaaS/CRM asks are still complex (the original centralization guarantee holds)', () => {
      for (const p of ['build a SaaS CRM', 'a saas billing platform', 'make an e-commerce store']) {
        expect(isComplexAppPrompt(p)).toBe(true);
      }
    });
  });
});
