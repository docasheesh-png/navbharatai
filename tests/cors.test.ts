import { describe, it, expect, afterEach } from 'vitest';
import { setCorsHeaders } from '../src/server/lib/cors';

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) { headers[name] = value; },
  };
}

describe('setCorsHeaders', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('does nothing when origin is absent', () => {
    const res = makeRes();
    setCorsHeaders({ headers: {} }, res);
    expect(res.headers).toEqual({});
  });

  it('sets Access-Control-Allow-Origin in non-production', () => {
    process.env.NODE_ENV = 'development';
    const res = makeRes();
    setCorsHeaders({ headers: { origin: 'http://localhost:5173' } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  it('sets Vary: Origin when allowing the origin', () => {
    process.env.NODE_ENV = 'development';
    const res = makeRes();
    setCorsHeaders({ headers: { origin: 'http://localhost:3000' } }, res);
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('allows navbharatai.web.app in production', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    setCorsHeaders({ headers: { origin: 'https://navbharatai.web.app' } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://navbharatai.web.app');
  });

  it('blocks unknown origin in production', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    setCorsHeaders({ headers: { origin: 'https://evil.com' } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
