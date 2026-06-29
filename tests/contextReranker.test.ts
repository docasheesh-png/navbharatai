import { describe, it, expect } from 'vitest';
import {
  tokenize,
  rankByBM25,
  firstRelevantLine,
  snippetAround,
  buildGroundedContext,
} from '../src/server/AgentV3/ContextReranker';

/** P-AI.2 — dependency-free BM25 RAG reranker + grounding (pure). */

describe('ContextReranker — tokenize', () => {
  it('lowercases, splits, drops stopwords + 1-char tokens', () => {
    expect(tokenize('Fix the Login Button!')).toEqual(['login', 'button']);
    expect(tokenize('a I to')).toEqual([]); // all stopwords/short
  });
});

const files = {
  'src/auth/login.ts': 'export function login(email, password) { /* authenticate user */ return true; }',
  'src/components/Navbar.tsx': 'export function Navbar() { return "nav with links and logo"; }',
  'src/utils/format.ts': 'export function formatDate(d) { return d.toISOString(); }',
};

describe('ContextReranker — rankByBM25', () => {
  it('ranks the most relevant file first', () => {
    const ranked = rankByBM25(files, 'fix the login authentication', 3);
    expect(ranked[0].path).toBe('src/auth/login.ts');
    expect(ranked[0].score).toBeGreaterThan(0);
  });
  it('returns [] for a query with no overlap', () => {
    expect(rankByBM25(files, 'kubernetes helm chart')).toEqual([]);
  });
  it('returns [] for an empty query / no files', () => {
    expect(rankByBM25(files, '')).toEqual([]);
    expect(rankByBM25({}, 'login')).toEqual([]);
  });
  it('respects the limit', () => {
    expect(rankByBM25(files, 'function export', 1).length).toBeLessThanOrEqual(1);
  });
});

describe('ContextReranker — citations + snippet', () => {
  it('firstRelevantLine finds the line with a query term', () => {
    const content = 'line one\nthe login function\nline three';
    expect(firstRelevantLine(content, 'login')).toBe(2);
  });
  it('firstRelevantLine defaults to 1 when nothing matches', () => {
    expect(firstRelevantLine('a\nb\nc', 'zzz')).toBe(1);
  });
  it('snippetAround returns lines around the target', () => {
    const content = '1\n2\n3\n4\n5\n6\n7';
    expect(snippetAround(content, 4, 1)).toBe('3\n4\n5');
  });
});

describe('ContextReranker — buildGroundedContext', () => {
  it('builds a cited grounding block from the top files', () => {
    const ctx = buildGroundedContext(files, 'login password', 2);
    expect(ctx).toContain('RELEVANT EXISTING FILES');
    expect(ctx).toContain('src/auth/login.ts:'); // citation with line
  });
  it('returns empty string when nothing is relevant', () => {
    expect(buildGroundedContext(files, 'kubernetes helm', 3)).toBe('');
    expect(buildGroundedContext({}, 'login', 3)).toBe('');
  });
});
