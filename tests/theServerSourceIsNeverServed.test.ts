// Forensic audit 2026-10-04 (P1) — the server's bundle and sourcemap are never served to a browser.
//
// Production serves `dist/` as the public static root, and the build writes `dist/server.cjs` plus a 27 MB
// `server.cjs.map` holding every server source file. Both answered 200. A deny list now runs before both
// static handlers; this test drives it through real Express static serving of a real directory.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { denyServerOnlyArtifacts, isServerOnlyArtifactPath, SERVER_ONLY_ARTIFACTS } from '../src/server/lib/serverOnlyArtifacts';
import { SERVER_ONLY_ARTIFACTS as NATIVE_LIST } from '../scripts/stripServerFromNativeBundle.mjs';

let dir = '';
let server: ReturnType<express.Express['listen']>;
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

beforeAll(() => {
  dir = mkdtempSync(join(os.tmpdir(), 'nb-dist-'));
  for (const f of ['server.cjs', 'server.js', 'server.cjs.map', 'server.cjs.map.gz', 'index.js.map', 'index.html', 'build_status.json']) writeFileSync(join(dir, f), `content of ${f}`);
  const app = express();
  app.use(denyServerOnlyArtifacts());
  app.use(express.static(dir));
  server = app.listen(0);
});
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

describe('the server artifacts answer 404, every spelling', () => {
  for (const p of ['/server.cjs', '/server.cjs.map', '/server.cjs.map.gz', '/SERVER.CJS.MAP', '/%73erver.cjs.map', '/./server.cjs', '/assets/../server.cjs.map', '/server.cjs.m%61p', '/index.js.map', '/index.js.m%61p', '/server.js']) {
    it(p, async () => { expect((await fetch(`${base()}${p}`)).status).toBe(404); });
  }
});

describe('the public files are still served', () => {
  for (const p of ['/index.html', '/build_status.json']) {
    it(p, async () => { expect((await fetch(`${base()}${p}`)).status).toBe(200); });
  }
});

describe('one list for both lanes', () => {
  it('the web deny list equals the phone-bundle strip list', () => {
    expect([...SERVER_ONLY_ARTIFACTS]).toEqual([...NATIVE_LIST]);
  });

  it('a malformed escape is not an artifact and does not throw', () => {
    expect(isServerOnlyArtifactPath('/%E0%A4%A')).toBe(false);
  });

  it('production mounts the deny list before the static handlers', () => {
    const src = readFileSync('server.ts', 'utf8');
    const deny = src.indexOf('app.use(denyServerOnlyArtifacts());');
    expect(deny).toBeGreaterThan(0);
    expect(deny).toBeLessThan(src.indexOf('app.use(precompressedStatic(distPath));'));
    expect(deny).toBeLessThan(src.indexOf('app.use(express.static(distPath'));
  });
});

describe('the two private-file predicates are one (merge of #3529 and #3538)', () => {
  it('there is no second predicate module — the decoded one is the only one', async () => {
    // #3529's privateBuildFiles.ts read the RAW path and let /server.cjs.m%61p through. After the merge it
    // survived only as an alias nothing imported (deadCodeGuard flagged it), so it was removed.
    const { existsSync } = await import('node:fs');
    expect(existsSync('src/server/lib/privateBuildFiles.ts')).toBe(false);
    for (const p of ['/server.cjs', '/server.cjs.map', '/server.cjs.m%61p', '/assets/app.js.map', '/a/../server.cjs', '/server.js']) {
      expect(isServerOnlyArtifactPath(p), p).toBe(true);
    }
    for (const p of ['/assets/app.js', '/index.html', '/sw.js']) expect(isServerOnlyArtifactPath(p), p).toBe(false);
  });
});
