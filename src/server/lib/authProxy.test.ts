import { describe, it, expect } from 'vitest';
import { createAuthProxy } from './authProxy';

function fakeRes() {
  return {
    headersSent: false,
    statusCode: 0,
    body: '',
    destroyed: false,
    writeHead() { this.headersSent = true; },
    status(code: number) { this.statusCode = code; return this; },
    end(body?: string) { this.body = body ?? ''; this.headersSent = true; },
    destroy() { this.destroyed = true; },
  };
}

describe('BLD-10 auth proxy does not hang after headers', () => {
  it('an upstream error BEFORE headers is 504 and does not require destroy', () => {
    let onError: (() => void) | undefined;
    const res = fakeRes();
    const proxy = createAuthProxy({
      request: () => ({
        on(event: string, fn: () => void) { if (event === 'error') onError = fn; return this; },
        destroy() {},
      }),
    });
    proxy({ originalUrl: '/__/auth/handler', method: 'GET', headers: {}, pipe() { return this; } }, res);
    onError?.();
    expect(res.statusCode).toBe(504);
    expect(res.body).toBe('Auth proxy timeout');
    expect(res.destroyed).toBe(false);
  });

  it('an upstream error AFTER headers were sent calls res.destroy()', () => {
    let onError: (() => void) | undefined;
    let onResponse: ((pres: any) => void) | undefined;
    const res = fakeRes();
    const proxy = createAuthProxy({
      request: (_opts: unknown, cb?: (pres: any) => void) => {
        onResponse = cb;
        return {
          on(event: string, fn: () => void) { if (event === 'error') onError = fn; return this; },
          destroy() {},
        };
      },
    });
    proxy({
      originalUrl: '/__/auth/handler',
      method: 'GET',
      headers: { host: 'navbharatai.com' },
      pipe() { return this; },
    }, res);
    onResponse?.({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      pipe() {},
      on() {},
    });
    expect(res.headersSent).toBe(true);
    onError?.();
    expect(res.destroyed).toBe(true);
    expect(res.statusCode).not.toBe(504);
  });

  it('an error on the piped upstream response destroys res', () => {
    let presOnError: (() => void) | undefined;
    const res = fakeRes();
    const proxy = createAuthProxy({
      request: (_opts: unknown, cb?: (pres: any) => void) => {
        cb?.({
          statusCode: 200,
          headers: { 'set-cookie': 'sid=1; Domain=gen-lang-client-0866594388.firebaseapp.com; Path=/' },
          pipe() {},
          on(event: string, fn: () => void) { if (event === 'error') presOnError = fn; },
        });
        return {
          on() { return this; },
          destroy() {},
        };
      },
    });
    proxy({
      originalUrl: '/__/auth/handler',
      method: 'GET',
      headers: { host: 'navbharatai.com' },
      pipe() { return this; },
    }, res);
    expect(res.headersSent).toBe(true);
    presOnError?.();
    expect(res.destroyed).toBe(true);
  });
});
