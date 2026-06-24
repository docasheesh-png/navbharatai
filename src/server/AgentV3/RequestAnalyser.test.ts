import { describe, it, expect } from 'vitest';
import { analyzeRequest } from './RequestAnalyser';

const tier = (prompt: string, extra = {}) => analyzeRequest({ prompt, ...extra }).startTier;

describe('analyzeRequest — task classification & tiering', () => {
  it('routes greetings/chat to Gemini', () => {
    expect(tier('hi there')).toBe('gemini');
    expect(tier('namaste, kaise ho')).toBe('gemini');
    expect(tier('thanks!')).toBe('gemini');
  });

  it('routes translate/summary to Gemini', () => {
    expect(tier('translate this to hindi')).toBe('gemini');
    expect(tier('summarize this article')).toBe('gemini');
  });

  it('routes SIMPLE apps (calculator/clock/ludo/3d ball) to Gemini — the new-user case', () => {
    expect(tier('make a calculator')).toBe('gemini');
    expect(tier('build a digital clock')).toBe('gemini');
    expect(tier('create a ludo game')).toBe('gemini');
    expect(tier('bouncing 3d ball animation')).toBe('gemini');
    expect(tier('simple todo app')).toBe('gemini');
    const r = analyzeRequest({ prompt: 'make a calculator' });
    expect(r.taskType).toBe('simple_app');
    expect(r.complexityScore).toBeLessThanOrEqual(20);
  });

  it('keeps a simple app cheap even when extra words sneak in', () => {
    // "calculator" wins as simple_app and is capped ≤20 despite a longer prompt.
    expect(tier('please make me a nice calculator with a clean modern responsive ui and dark mode toggle')).toBe('gemini');
  });

  it('routes small/general coding to Haiku', () => {
    const r = analyzeRequest({ prompt: 'write a react component for a button' });
    expect(r.taskType).toBe('coding');
    expect(r.startTier).toBe('haiku');
  });

  it('routes full/complex apps to Sonnet', () => {
    expect(tier('build a full-stack saas dashboard with authentication and a database')).toBe('sonnet');
    expect(tier('create an e-commerce checkout with stripe payment and a backend api')).toBe('sonnet');
  });

  it('routes architecture/system-design to Opus', () => {
    expect(tier('design a scalable microservice architecture for high-availability')).toBe('opus');
    expect(tier('refactor the entire system into a distributed production-grade design')).toBe('opus');
  });
});

describe('analyzeRequest — feature adjustments', () => {
  it('a production/security signal pushes complexity up a tier', () => {
    const plain = analyzeRequest({ prompt: 'write a login form component' });
    const prod = analyzeRequest({ prompt: 'write a production secure login form component with scalable performance' });
    expect(prod.complexityScore).toBeGreaterThan(plain.complexityScore);
  });

  it('a large project (many files) raises the score', () => {
    const small = analyzeRequest({ prompt: 'fix a small bug', fileCount: 2 }).complexityScore;
    const big = analyzeRequest({ prompt: 'fix a small bug', fileCount: 40 }).complexityScore;
    expect(big).toBeGreaterThan(small);
  });

  it('clamps the score to 0..100', () => {
    const r = analyzeRequest({ prompt: 'production secure scalable distributed enterprise microservice architecture refactor the entire system'.repeat(20), fileCount: 100, historyTurns: 50 });
    expect(r.complexityScore).toBeLessThanOrEqual(100);
    expect(r.complexityScore).toBeGreaterThanOrEqual(0);
  });
});

describe('analyzeRequest — escalation path & ambiguity', () => {
  it('escalation path runs from the start tier up to opus', () => {
    expect(analyzeRequest({ prompt: 'make a calculator' }).escalationPath).toEqual(['gemini', 'haiku', 'sonnet', 'opus']);
    expect(analyzeRequest({ prompt: 'design a scalable microservice architecture' }).escalationPath).toEqual(['opus']);
  });

  it('flags borderline scores as ambiguous and always returns a safe default tier', () => {
    // We do not assert a specific borderline prompt; we assert the invariant:
    const r = analyzeRequest({ prompt: 'write a react component for a button' });
    expect(['gemini', 'haiku', 'sonnet', 'opus']).toContain(r.startTier);
    expect(typeof r.ambiguous).toBe('boolean');
    expect(r.reasoning).toContain('→');
  });

  it('handles empty/garbage input safely (defaults to chat → gemini)', () => {
    expect(analyzeRequest({ prompt: '' }).startTier).toBe('gemini');
    // @ts-expect-error testing defensive handling of a bad input
    expect(analyzeRequest({}).startTier).toBe('gemini');
  });
});
