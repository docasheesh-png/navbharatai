/**
 * A WebSocket built from `window.location.host` works on the web and is broken in the app.
 *
 * ADMIN REPORT 2026-08-13: Sonic voice did nothing in the Android and iOS builds. The socket was
 * built from the page's own host, which in the BUNDLED shell is `localhost` — so the phone opened a
 * connection to itself. It escaped every existing safeguard because `installNativeApiRewrite` patches
 * `fetch` and `XMLHttpRequest`, and a WebSocket is neither.
 *
 * There was only ever ONE socket in the app, so this is a guard against the SECOND one: the next
 * feature that needs streaming must go through `resolveWebSocketUrl`, or it will ship with exactly
 * this bug and nobody will notice until a user reports it from a phone.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const OWNER = 'apiBase.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');

const files = walk(SRC)
  .filter((f) => !f.endsWith(OWNER))
  .map((f) => ({ path: f.slice(SRC.length + 1), code: codeOnly(readFileSync(f, 'utf8')) }));

describe('🔒 every WebSocket goes through the shared resolver', () => {
  it('nobody builds a socket URL from the page’s own host', () => {
    const offenders = files
      .filter((f) => /new WebSocket\([^)]*location\.(host|origin)/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `use resolveWebSocketUrl() from lib/apiBase:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('🔒 any socket that IS opened uses the resolver', () => {
    const offenders = files
      .filter((f) => /new WebSocket\(/.test(f.code) && !/resolveWebSocketUrl/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `these open a raw socket:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the guard is actually scanning files', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(() => readFileSync(join(SRC, 'lib', OWNER), 'utf8')).not.toThrow();
  });
});
