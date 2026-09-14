/**
 * THE EXPRESS 4 → 5 SEAMS. Two of the three are invisible to TypeScript, which is why they are tested
 * here rather than trusted to a green typecheck.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splatPath, routeParam, routeParams, normalizeMissingBody } from '../src/server/lib/expressCompat';

describe('splatPath — a wildcard capture is an ARRAY in Express 5, not req.params[0]', () => {
  it('rejoins the segments Express 5 hands over', () => {
    expect(splatPath({ splat: ['react', 'jsx-runtime'] })).toBe('react/jsx-runtime');
    expect(splatPath({ splat: ['index.js'] })).toBe('index.js');
  });

  it('still understands the Express 4 spellings, so a mixed route cannot silently break', () => {
    expect(splatPath({ 0: 'react/jsx-runtime' })).toBe('react/jsx-runtime');
    expect(splatPath({ splat: 'react/jsx-runtime' })).toBe('react/jsx-runtime');
  });

  it('an absent capture is an empty path, never "undefined" in a URL', () => {
    // Both callers build an upstream URL from this. A literal "undefined" would fetch the wrong thing
    // rather than fail — which is the whole reason this conversion lives in one place.
    expect(splatPath({})).toBe('');
    expect(splatPath(undefined)).toBe('');
    expect(splatPath(null)).toBe('');
    expect(splatPath({ splat: [] })).toBe('');
  });
});

describe('routeParam / routeParams — Express 5 widened every param to string | string[]', () => {
  it('passes a plain string through untouched', () => {
    expect(routeParam('u123')).toBe('u123');
    expect(routeParams({ userId: 'u1', id: 'a2' })).toEqual({ userId: 'u1', id: 'a2' });
  });

  it('a missing param is an empty string, not undefined', () => {
    expect(routeParam(undefined)).toBe('');
  });

  it('an array (only reachable on a wildcard route) is joined, never "[object Object]"', () => {
    expect(routeParam(['a', 'b'])).toBe('a/b');
  });
});

describe('🔴 normalizeMissingBody — the hazard no typecheck could ever see', () => {
  // Express 4 gave `{}` when a parser found nothing; Express 5 leaves `undefined`. 419 places in this
  // repo read req.body, all typed `any`, so every one of them type-checks clean and throws at runtime.
  it('fills in the Express 4 default when the parser left nothing', () => {
    const req: { body?: unknown } = {};
    let next = false;
    normalizeMissingBody(req, {}, () => { next = true; });
    expect(req.body).toEqual({});
    expect(next).toBe(true);
  });

  it('🔒 NEVER replaces a body that was actually parsed', () => {
    for (const parsed of [{ a: 1 }, [1, 2], 'raw text', 0, false, null]) {
      const req: { body?: unknown } = { body: parsed };
      normalizeMissingBody(req, {}, () => {});
      expect(req.body).toBe(parsed); // including null, 0 and false — only `undefined` is filled
    }
  });

  it('always calls next(), so it can never stall a request', () => {
    let n = 0;
    normalizeMissingBody({ body: undefined }, {}, () => { n++; });
    normalizeMissingBody({ body: { x: 1 } }, {}, () => { n++; });
    expect(n).toBe(2);
  });
});

describe('🔒 the wiring — what would break the server at STARTUP if it regressed', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const server = read('server.ts');

  it('no route registers a bare "*" — path-to-regexp v8 throws on it', () => {
    // This is not a style rule: an invalid path means the server does not start at all.
    for (const src of ['server.ts', 'src/server/routes/esmMirror.ts', 'src/server/routes/preview.ts']) {
      const code = read(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${src} still registers a bare '*' route`)
        .not.toMatch(/\.(get|post|put|delete|all|use)\(\s*['"][^'"]*\*(?!splat)/);
    }
  });

  it('the SPA catch-all uses the Express 5 spelling', () => {
    expect(server).toContain("app.get('/*splat'");
  });

  it('🔒 the body default is restored AFTER the parsers, or it would overwrite a real body', () => {
    const parser = server.indexOf('app.use(express.json({');
    const normal = server.indexOf('app.use(normalizeMissingBody)');
    expect(parser).toBeGreaterThan(-1);
    expect(normal).toBeGreaterThan(parser);
  });
});
