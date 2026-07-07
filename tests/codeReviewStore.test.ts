import { describe, it, expect } from 'vitest';
import { buildComment, buildReply, MAX_COMMENT_BODY } from '../src/server/lib/CodeReviewStore';

describe('buildComment', () => {
  const base = { id: 'c1', workspaceId: 'ws1', author: 'u1', now: 1000 };

  it('builds a valid comment (unresolved, no replies)', () => {
    const c = buildComment({ ...base, file: 'src/App.tsx', line: 42, body: 'refactor this' });
    expect(c).not.toBeNull();
    expect(c!.file).toBe('src/App.tsx');
    expect(c!.line).toBe(42);
    expect(c!.resolved).toBe(false);
    expect(c!.replies).toEqual([]);
    expect(c!.createdAt).toBe(1000);
  });

  it('floors a fractional line and accepts line 0', () => {
    expect(buildComment({ ...base, file: 'a.ts', line: 3.9, body: 'x' })!.line).toBe(3);
    expect(buildComment({ ...base, file: 'a.ts', line: 0, body: 'x' })!.line).toBe(0);
  });

  it('rejects missing file / empty body / negative or non-numeric line', () => {
    expect(buildComment({ ...base, file: '', line: 1, body: 'x' })).toBeNull();
    expect(buildComment({ ...base, file: 'a.ts', line: 1, body: '   ' })).toBeNull();
    expect(buildComment({ ...base, file: 'a.ts', line: -1, body: 'x' })).toBeNull();
    expect(buildComment({ ...base, file: 'a.ts', line: 'nope', body: 'x' })).toBeNull();
  });

  it('rejects a missing workspaceId / id', () => {
    expect(buildComment({ ...base, workspaceId: '', file: 'a.ts', line: 1, body: 'x' })).toBeNull();
    expect(buildComment({ ...base, id: '', file: 'a.ts', line: 1, body: 'x' })).toBeNull();
  });

  it('caps an oversized body', () => {
    const c = buildComment({ ...base, file: 'a.ts', line: 1, body: 'x'.repeat(MAX_COMMENT_BODY + 500) });
    expect(c!.body.length).toBe(MAX_COMMENT_BODY);
  });
});

describe('buildReply', () => {
  it('builds a valid reply', () => {
    const r = buildReply({ author: 'u2', body: 'good point', now: 2000 });
    expect(r).toEqual({ author: 'u2', body: 'good point', at: 2000 });
  });
  it('rejects a blank reply', () => {
    expect(buildReply({ author: 'u2', body: '   ', now: 2000 })).toBeNull();
    expect(buildReply({ author: 'u2', body: undefined, now: 2000 })).toBeNull();
  });
});
