// Q-671 (found 2026-10-05 while fixing Q-623) — a Firebase "DevOps link" token can never be planted.
//
// App.tsx accepted a Firebase token three ways: a `FIREBASE_AUTH_SUCCESS` postMessage, a `#fb_token=` URL
// fragment, and a `firebase_token_signal` storage event. No server sends any of them — the only flow that
// ever did was a mock with fabricated credentials, and `/api/auth/firebase` now answers "not yet
// available" — so the only sender left was someone planting a token: the Q-623 GitHub hole, for Firebase.
// The three paths are gone and a stored token is dropped on load. This census keeps them gone.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files: string[] = [];
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) files.push(p);
  }
};
walk('src');
const code = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

describe('no path stores a Firebase token the app did not obtain itself', () => {
  it('nothing writes fb_token, fb_user or firebase_token_signal', () => {
    const writers = files.filter((f) => /setItem\(\s*['"](fb_token|fb_user|firebase_token_signal)['"]/.test(code(f)));
    expect(writers).toEqual([]);
  });

  it('no message handler accepts FIREBASE_AUTH_SUCCESS', () => {
    const handlers = files.filter((f) => /['"]FIREBASE_AUTH_SUCCESS['"]/.test(code(f)));
    expect(handlers).toEqual([]);
  });

  it('a #fb_token fragment is only ever cleared from the address bar, never read into state', () => {
    const app = code('src/App.tsx');
    expect(app).not.toMatch(/setFirebaseToken\(\s*(?!null\))/);
  });

  it('a token stored by an earlier version is dropped on load', () => {
    expect(code('src/App.tsx')).toMatch(/useState<string \| null>\(\(\) => \{\s*try \{ localStorage\.removeItem\('fb_token'\); localStorage\.removeItem\('fb_user'\);/);
  });

  it('the server still issues no Firebase token (if it ever does, this whole census must be revisited)', () => {
    const route = readFileSync('src/server/routes/firebaseAuth.ts', 'utf8');
    expect(route).not.toMatch(/FIREBASE_AUTH_SUCCESS|fb_token/);
  });
});
