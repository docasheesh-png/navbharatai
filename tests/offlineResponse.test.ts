import { describe, it, expect } from 'vitest';
import { generateOfflineResponse } from '../src/server/lib/offlineResponse';

describe('generateOfflineResponse', () => {
  it('returns a non-empty string for any input', () => {
    expect(generateOfflineResponse('build something')).toBeTruthy();
  });

  it('always includes the warning about unconfigured API keys', () => {
    const r = generateOfflineResponse('hello');
    expect(r).toContain('navBharatAI');
  });

  it('returns a Calculator template for "calculator" keyword', () => {
    const r = generateOfflineResponse('build a calculator');
    expect(r).toContain('Calculator');
  });

  it('returns a Calculator template for Hindi "hisaab" keyword', () => {
    const r = generateOfflineResponse('hisaab banao');
    expect(r).toContain('Calculator');
  });

  it('returns a Todo/Task template for "todo" keyword', () => {
    const r = generateOfflineResponse('build a todo app');
    expect(r).toContain('Task');
  });

  it('returns a Weather template for "weather" keyword', () => {
    const r = generateOfflineResponse('show me weather app');
    expect(r).toContain('Weather');
  });

  it('returns a Clock/Stopwatch template for "timer" keyword', () => {
    const r = generateOfflineResponse('build a timer app');
    expect(r).toContain('Focus');
  });

  it('returns a Notes template for "note" keyword', () => {
    const r = generateOfflineResponse('sticky notes app');
    expect(r).toContain('Note');
  });

  it('works with an empty message (no crash)', () => {
    expect(() => generateOfflineResponse('')).not.toThrow();
  });

  it('works with empty history array', () => {
    const r = generateOfflineResponse('build a clock', []);
    expect(r).toBeTruthy();
  });
});
