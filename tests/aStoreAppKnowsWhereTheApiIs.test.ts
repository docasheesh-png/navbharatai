// A store app runs in a srcdoc frame whose base is the parent page — the local shell in the Android/iOS app. The open
// route writes the API origin the request reached into the page (storeApiOrigin.ts), so the online Royale socket dials
// the API, not the phone. Only a strict scheme://host[:port] is ever written into the <script>.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { storeApiOrigin, withApiOrigin } from '../src/server/lib/storeApiOrigin';

describe('the store tells a page where the API is', () => {
  it('reads the host this request reached, with the forwarded scheme', () => {
    expect(storeApiOrigin({ host: 'navbharatai.com', 'x-forwarded-proto': 'https' })).toBe('https://navbharatai.com');
    expect(storeApiOrigin({ host: '127.0.0.1:8080' }, 'http')).toBe('http://127.0.0.1:8080');
    expect(storeApiOrigin({ host: 'navbharatai.com', 'x-forwarded-proto': 'https,http' })).toBe('https://navbharatai.com');
  });

  it('refuses any host that could break out of the script tag, or none at all', () => {
    for (const host of ['a.com</script><script>alert(1)', 'a.com"', 'a b', '', 'a.com/path']) {
      expect(storeApiOrigin({ host }), host).toBeNull();
    }
    expect(withApiOrigin('<body>x', null)).toBe('<body>x');
    expect(withApiOrigin('<body>x', 'https://a.com"></script>')).toBe('<body>x');
  });

  it('writes the origin once, at the start of the body', () => {
    expect(withApiOrigin('<html><body>x</body>', 'https://navbharatai.com'))
      .toBe('<html><body><script>window.__NBAI_API_ORIGIN="https://navbharatai.com";</script>x</body>');
  });

  it('the open route adds it per response, never into the shared compiled-player cache', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/navStore.ts'), 'utf8');
    expect(route).toContain('withApiOrigin(withNavDataAccess(compiled.html, found), apiOrigin)');
    expect(route).not.toMatch(/webPlayerCache\.set\([^)]*withApiOrigin/);
  });
});
