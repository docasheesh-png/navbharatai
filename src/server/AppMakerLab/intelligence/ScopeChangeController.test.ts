import { describe, it, expect, beforeEach } from 'vitest';
import { ScopeChangeController, MAX_PENDING_PER_NAMESPACE } from './ScopeChangeController';

describe('ScopeChangeController (P-PME.6 mid-build serialization)', () => {
  let c: ScopeChangeController;
  beforeEach(() => { c = new ScopeChangeController(); });

  it('first request proceeds and marks the namespace active', () => {
    const d = c.submit('ns1', 'build a todo app');
    expect(d.action).toBe('proceed');
    expect(c.isActive('ns1')).toBe(true);
  });

  it('a request arriving while a build runs is DEFERRED and queued (not a second build)', () => {
    c.submit('ns1', 'first');
    const d = c.submit('ns1', 'add dark mode');
    expect(d.action).toBe('defer');
    expect(d.queued).toBe(1);
    expect(d.message).toMatch(/in progress/i);
    expect(c.pendingCount('ns1')).toBe(1);
  });

  it('namespaces are independent (one workspace’s build never blocks another)', () => {
    c.submit('ns1', 'first');
    const d = c.submit('ns2', 'other workspace');
    expect(d.action).toBe('proceed');
    expect(c.isActive('ns2')).toBe(true);
  });

  it('complete() releases the lock and returns queued prompts in FIFO order', () => {
    c.submit('ns1', 'first');
    c.submit('ns1', 'change A');
    c.submit('ns1', 'change B');
    const pending = c.complete('ns1');
    expect(pending).toEqual(['change A', 'change B']);
    expect(c.isActive('ns1')).toBe(false);
    expect(c.pendingCount('ns1')).toBe(0);
  });

  it('after complete, the next submit proceeds again (serialized, not deadlocked)', () => {
    c.submit('ns1', 'first');
    c.complete('ns1');
    expect(c.submit('ns1', 'second').action).toBe('proceed');
  });

  it('caps the pending queue so mid-build spam cannot grow unbounded', () => {
    c.submit('ns1', 'running');
    for (let i = 0; i < MAX_PENDING_PER_NAMESPACE + 5; i++) c.submit('ns1', `change ${i}`);
    expect(c.pendingCount('ns1')).toBe(MAX_PENDING_PER_NAMESPACE);
  });

  it('complete on an idle namespace is a safe no-op (returns [])', () => {
    expect(c.complete('never-started')).toEqual([]);
    expect(c.isActive('never-started')).toBe(false);
  });

  it('the queued-count message pluralizes past the first queued change', () => {
    c.submit('ns1', 'running');
    expect(c.submit('ns1', 'a').message).not.toMatch(/changes queued/);
    expect(c.submit('ns1', 'b').message).toMatch(/2 changes queued/);
  });
});
