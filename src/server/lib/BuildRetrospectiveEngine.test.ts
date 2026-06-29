import { describe, it, expect } from 'vitest';
import {
  classifyFailure, buildRetrospective, relevantWarnings, type Retrospective,
} from './BuildRetrospectiveEngine';

describe('BuildRetrospectiveEngine (P-PME.5)', () => {
  describe('classifyFailure', () => {
    it('classifies common failure categories from the error text', () => {
      expect(classifyFailure("Cannot find module 'react-router'").category).toBe('dependency');
      expect(classifyFailure('SyntaxError: Unexpected token }').category).toBe('syntax');
      expect(classifyFailure("TS2322: Type 'string' is not assignable to type 'number'").category).toBe('type');
      expect(classifyFailure('Operation timed out after 30000ms').category).toBe('timeout');
      expect(classifyFailure('connect ECONNREFUSED 127.0.0.1:5432').category).toBe('network');
      expect(classifyFailure('ReferenceError: foo is not defined').category).toBe('runtime');
    });
    it('HONESTY: unrecognised errors are "unknown", not a confident wrong label', () => {
      expect(classifyFailure('something weird happened').category).toBe('unknown');
      expect(classifyFailure('').category).toBe('unknown');
    });
  });

  describe('buildRetrospective', () => {
    it('captures classification, strategies, root cause, and a reusable warning', () => {
      const r = buildRetrospective({
        framework: 'React',
        intent: 'todo app with auth',
        attempts: [{ strategy: 'add missing import' }, { strategy: 'install dependency' }],
        finalError: "Cannot find module '@/lib/auth'",
        timeSpentMs: 45_000,
      });
      expect(r.category).toBe('dependency');
      expect(r.attemptCount).toBe(2);
      expect(r.strategiesAttempted).toEqual(['add missing import', 'install dependency']);
      expect(r.timeSpentMs).toBe(45_000);
      expect(r.warning).toContain('[dependency]');
      expect(r.warning).toContain('React');
      expect(r.summary).toContain('todo app with auth');
    });

    it('handles a missing final error honestly', () => {
      const r = buildRetrospective({ framework: 'Vue', intent: 'blog', attempts: [] });
      expect(r.category).toBe('unknown');
      expect(r.finalError).toBe('');
      expect(r.summary).toContain('no final error captured');
    });
  });

  describe('relevantWarnings', () => {
    const history: Retrospective[] = [
      buildRetrospective({ framework: 'React', intent: 'todo app with auth', finalError: "Cannot find module 'x'" }),
      buildRetrospective({ framework: 'React', intent: 'dashboard charts', finalError: 'SyntaxError: Unexpected token' }),
      buildRetrospective({ framework: 'Vue', intent: 'todo list', finalError: 'TypeError: bad' }),
    ];

    it('ranks same-framework + overlapping-intent failures highest', () => {
      const out = relevantWarnings(history, { framework: 'React', intent: 'todo auth tracker' }, 3);
      expect(out.length).toBeGreaterThan(0);
      // The React + "todo/auth" retro should rank first.
      expect(out[0].warning).toContain('[dependency]');
      expect(out[0].score).toBeGreaterThanOrEqual(out[out.length - 1].score);
    });

    it('returns nothing when there is no overlap', () => {
      expect(relevantWarnings(history, { framework: 'Svelte', intent: 'xyz' })).toEqual([]);
    });

    it('respects the topN cap', () => {
      const out = relevantWarnings(history, { framework: 'React', intent: 'todo app dashboard auth charts' }, 1);
      expect(out.length).toBe(1);
    });
  });
});
