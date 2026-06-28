import { describe, it, expect, beforeEach } from 'vitest';
import { errorTracker } from './ErrorTracker';
import { tracer } from './Tracer';

describe('ErrorTracker (P2.2 external error tracking)', () => {
  beforeEach(() => { errorTracker.clear(); });

  it('captures an Error with message + stack', () => {
    const rec = errorTracker.capture(new Error('boom'));
    expect(rec.message).toBe('boom');
    expect(rec.stack).toContain('boom');
    expect(rec.source).toBe('server');
    expect(errorTracker.recent()).toHaveLength(1);
  });

  it('coerces a non-Error value into a captured error', () => {
    const rec = errorTracker.capture('just a string');
    expect(rec.message).toBe('just a string');
    const rec2 = errorTracker.capture({ weird: true });
    expect(rec2.message).toContain('weird');
  });

  it('records the provided source + http context', () => {
    const rec = errorTracker.capture(new Error('500'), {
      source: 'middleware', httpMethod: 'POST', httpUrl: '/api/x', httpStatus: 500,
    });
    expect(rec.source).toBe('middleware');
    expect(rec.context.httpUrl).toBe('/api/x');
    expect(rec.context.httpStatus).toBe(500);
  });

  it('correlates with the active trace when inside a request span', () => {
    const root = tracer.startSpan('request');
    let rec!: ReturnType<typeof errorTracker.capture>;
    tracer.runInSpan(root, () => { rec = errorTracker.capture(new Error('in-trace')); });
    root.end();
    expect(rec.traceId).toBe(root.data.traceId);
  });

  it('has no traceId outside a request', () => {
    const rec = errorTracker.capture(new Error('no-trace'));
    expect(rec.traceId).toBeUndefined();
  });

  it('recent() returns newest-first', () => {
    errorTracker.capture(new Error('first'));
    errorTracker.capture(new Error('second'));
    const recent = errorTracker.recent();
    expect(recent[0].message).toBe('second');
    expect(recent[1].message).toBe('first');
  });

  it('summary() groups by message with counts, lastTs and sources', () => {
    errorTracker.capture(new Error('dup'), { source: 'server' });
    errorTracker.capture(new Error('dup'), { source: 'client' });
    errorTracker.capture(new Error('unique'));
    const summary = errorTracker.summary();
    const dup = summary.find(s => s.message === 'dup')!;
    expect(dup.count).toBe(2);
    expect(dup.sources.sort()).toEqual(['client', 'server']);
    expect(summary.find(s => s.message === 'unique')!.count).toBe(1);
  });

  it('capture never throws, even on hostile input', () => {
    const circular: any = {}; circular.self = circular;
    expect(() => errorTracker.capture(circular)).not.toThrow();
    expect(() => errorTracker.capture(undefined)).not.toThrow();
    expect(() => errorTracker.capture(null)).not.toThrow();
  });

  it('bounds the buffer (does not grow without limit)', () => {
    for (let i = 0; i < 600; i++) errorTracker.capture(new Error(`e${i}`));
    // maxErrors is 500 — buffer must be capped.
    expect(errorTracker.recent(1000).length).toBeLessThanOrEqual(500);
  });
});
