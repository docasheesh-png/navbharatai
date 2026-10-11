/**
 * A FAST, SUCCESSFUL PAGE OR ASSET REQUEST WRITES NO LOG LINE (performance audit 2026-10-11, F13).
 *
 * Every request — every JS chunk, every icon — wrote TWO lines: `[TRACE][API ENTRY]` from the trace middleware
 * and a `[SPAN]` line when it ended. One page view is dozens of assets, so logging cost scaled with traffic on
 * paths nobody debugs, and the admin's 1000-span trace view was mostly icons. Now the session and conversation
 * ids ride on the span, the extra line is gone, and a routine span is neither logged nor kept. Errors, slow
 * requests, every `/api` call and every child span still are.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Tracer, isRoutineSpan, SLOW_SPAN_MS } from '../src/server/observability/Tracer';

const root = resolve(__dirname, '..');

function httpSpan(path: string, code: number, ms: number, status: 'ok' | 'error' = 'ok') {
  return { name: `HTTP GET ${path}`, status, durationMs: ms, attributes: { 'http.path': path, 'http.status_code': code } };
}

describe('which spans are routine', () => {
  it('a fast 200 for an asset or a page is routine', () => {
    expect(isRoutineSpan(httpSpan('/assets/index-abc.js', 200, 4))).toBe(true);
    expect(isRoutineSpan(httpSpan('/', 304, 2))).toBe(true);
  });

  it('🔒 every /api request, error, 4xx and slow request is still logged', () => {
    expect(isRoutineSpan(httpSpan('/api/wallet', 200, 4))).toBe(false);
    expect(isRoutineSpan(httpSpan('/assets/x.js', 500, 4, 'error'))).toBe(false);
    expect(isRoutineSpan(httpSpan('/missing', 404, 4))).toBe(false);
    expect(isRoutineSpan(httpSpan('/', 200, SLOW_SPAN_MS))).toBe(false);
  });

  it('🔒 a child span (an AI call, a database call) is never routine', () => {
    expect(isRoutineSpan({ name: 'ai.provider.call', status: 'ok', durationMs: 3, attributes: { 'http.path': '/' } })).toBe(false);
  });

  it('a span with no status code yet is not dropped', () => {
    expect(isRoutineSpan({ name: 'HTTP GET /', status: 'ok', durationMs: 3, attributes: { 'http.path': '/' } })).toBe(false);
  });

  it('a routine span is not kept in the trace view; an /api span is', () => {
    const t = new Tracer(100);
    const a = t.startSpan('HTTP GET /assets/a.js', { attributes: { 'http.path': '/assets/a.js' } }, 1000);
    a.setAttribute('http.status_code', 200);
    a.end(1005);
    const b = t.startSpan('HTTP GET /api/me', { attributes: { 'http.path': '/api/me' } }, 1000);
    b.setAttribute('http.status_code', 200);
    b.end(1005);
    expect(t.recentTraces().map((x) => x.rootName)).toEqual(['HTTP GET /api/me']);
  });
});

describe('the trace middleware', () => {
  const server = readFileSync(join(root, 'server.ts'), 'utf8');

  it('🔒 writes no per-request console line of its own', () => {
    expect(server).not.toMatch(/\[TRACE\]\[API ENTRY\]/);
  });

  it('puts the session and conversation ids on the span, bounded', () => {
    expect(server).toMatch(/sessionId: String\(sessionId\)\.slice\(0, 128\), conversationId: String\(conversationId\)\.slice\(0, 128\)/);
  });
});
