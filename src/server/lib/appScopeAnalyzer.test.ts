import { describe, it, expect } from 'vitest';
import { analyzeAppScope } from './appScopeAnalyzer';

describe('analyzeAppScope — default is DIRECT; only a STRONG mega-signal escalates', () => {
  it('ordinary apps build directly (no friction, no LLM cost) — today\'s behaviour', () => {
    for (const p of [
      'make a to-do list app',
      'ek restaurant menu app banao with categories and prices',
      'a personal blog with posts and an about page',
      'portfolio website for a photographer',
      'a coin collector 3D game with levels and hazards',
      'expense tracker with charts',
      'a quiz app with 10 questions and a score',
    ]) {
      expect(analyzeAppScope(p).decision, p).toBe('direct');
    }
  });

  it('famous AAA products escalate to the LLM roadmap', () => {
    for (const [p, name] of [
      ['PUBG jaisa game banao', 'PUBG'],
      ['make an app like Instagram', 'Instagram'],
      ['whatsapp jaisa messenger banao', 'WhatsApp'],
      ['ChatGPT jaisa AI banao', 'an AI like Claude/ChatGPT'],
      ['clone of Uber for my city', 'Uber / Ola'],
    ] as const) {
      const s = analyzeAppScope(p);
      expect(s.decision, p).toBe('analyze');
      expect(s.size).toBe('large');
      expect(s.famousApp).toBe(name);
    }
  });

  it('heavy infrastructure escalates even without a famous name', () => {
    for (const p of [
      'an app where users can message each other in real-time',
      'a multiplayer online battle game',
      'video calling app between two people',
      'train an AI model on my data',
    ]) {
      expect(analyzeAppScope(p).decision, p).toBe('analyze');
    }
  });

  it('a huge multi-feature spec (an AI-written PRD) is large — SCOPE not length', () => {
    const prd = [
      'Build a platform with:',
      '1. user registration and login',
      '2. profile pages',
      '3. a marketplace of products',
      '4. shopping cart and checkout',
      '5. seller dashboards',
      '6. order management',
      '7. reviews and ratings',
      '8. a recommendation engine',
      '9. an admin panel',
      '10. push notifications',
    ].join('\n');
    expect(analyzeAppScope(prd).decision).toBe('analyze');
    expect(analyzeAppScope(prd).signals.join(' ')).toMatch(/distinct features/);
  });

  it('a LONG prompt for a SMALL app is still small (length is not scope)', () => {
    const wordy = 'I would really love it if you could please build me a simple, clean, beautiful, '
      + 'modern, minimal to-do list app where I can add a task, mark it done, and delete it — that is all, '
      + 'nothing fancy, just a lovely little todo list with a nice font and some colour.';
    expect(analyzeAppScope(wordy).decision).toBe('direct');
  });

  it('a small app that merely lists a few tweaks does not tip into "large"', () => {
    // A todo app with several small asks is still a todo app — the CLEARLY_SMALL hint holds it direct.
    const p = 'a todo app: add tasks, edit tasks, delete tasks, mark done, filter, sort, dark mode, and a counter';
    expect(analyzeAppScope(p).decision).toBe('direct');
  });

  it('is pure and safe on empty / junk input', () => {
    expect(analyzeAppScope('').decision).toBe('direct');
    expect(() => analyzeAppScope(null as never)).not.toThrow();
    const s = analyzeAppScope('');
    expect(Array.isArray(s.signals)).toBe(true);
  });
});
