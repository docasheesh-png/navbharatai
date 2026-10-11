import { describe, it, expect } from 'vitest';
import { findCoreHttpServer, createsCoreHttpServer } from './coreHttpServer';
import { planDeployment } from './deployPlan';
import { detectBackendPresence } from './BackendPresence';

/**
 * Q-707 — a plain `node:http` server was not a server to any detector in this codebase, because
 * every one of them recognised a server by its FRAMEWORK. The harm was silent in two places:
 * deployPlan published the app as a static site with its API dead, and BackendPresence withheld the
 * "this app needs a live server" banner from a preview that was therefore silently broken.
 *
 * The census below is of real server SHAPES, which is the thing that actually varies — not of the
 * one file that happened to be in the report.
 */

const SERVER_SHAPES: Array<[string, string]> = [
  ['require + createServer + listen', `const http = require('http');
http.createServer((req, res) => { res.end('hi'); }).listen(3000);`],
  ['node: prefix', `const http = require('node:http');
const s = http.createServer(handler); s.listen(8080);`],
  ['ESM default import', `import http from 'http';
const server = http.createServer(app); server.listen(process.env.PORT);`],
  ['ESM named import', `import { createServer } from 'node:http';
createServer((req, res) => res.end()).listen(3000);`],
  ['https', `import https from 'node:https';
https.createServer(opts, handler).listen(443);`],
  ['http2', `const http2 = require('node:http2');
http2.createSecureServer(opts).listen(8443);`],
  ['createServer without an explicit listen in the same file', `import http from 'http';
export const server = http.createServer(handler);`],
];

describe('every real server shape is recognised', () => {
  it.each(SERVER_SHAPES)('%s', (_name, code) => {
    expect(createsCoreHttpServer({ 'server.js': code })).toBe(true);
  });

  it('names the file and the module, so a message can point at it', () => {
    const hit = findCoreHttpServer({ 'src/api/server.ts': "import http from 'node:http';\nhttp.createServer(h);" });
    expect(hit).toEqual({ path: 'src/api/server.ts', module: 'node:http' });
  });
});

/**
 * 🔒 The precision half. A CLIENT imports `http` too, and calling that a server would REFUSE a
 * working static publish — the 2026-08-25 harm (a dev dependency read as a server) in a new costume.
 */
const NOT_SERVERS: Array<[string, Record<string, string>]> = [
  ['an http CLIENT (http.get only)', { 'fetchData.js': "const http = require('http');\nhttp.get('http://x/y', cb);" }],
  ['an https client', { 'api.ts': "import https from 'node:https';\nhttps.request(opts, cb);" }],
  ['createServer from something that is not core http', { 'dev.ts': "import { createServer } from 'vite';\ncreateServer();" }],
  ['the word http in prose only', { 'README-ish.ts': "// talks to an http server somewhere\nexport const x = 1;" }],
  ['a non-code file that happens to contain both', { 'notes.md': "import http from 'http'; http.createServer(x)" }],
  ['no files at all', {}],
];

describe('an HTTP client is never mistaken for a server', () => {
  it.each(NOT_SERVERS)('%s', (_name, files) => {
    expect(createsCoreHttpServer(files)).toBe(false);
  });

  it('tolerates junk input without throwing', () => {
    expect(createsCoreHttpServer(null as unknown as Record<string, string>)).toBe(false);
    expect(createsCoreHttpServer({ 'a.js': undefined as unknown as string })).toBe(false);
  });
});

describe('THE BUG: such an app is no longer published as a static site', () => {
  const app = {
    'package.json': JSON.stringify({ name: 'probe', scripts: { start: 'node server.js' } }),
    'server.js': "const http = require('node:http');\nhttp.createServer((req,res)=>res.end('ok')).listen(process.env.PORT||8080);",
  };

  it('planDeployment calls it a node-server, NOT static', () => {
    const plan = planDeployment(app);
    expect(plan.shape).toBe('node-server');
    expect(plan.staticHostingSufficient).toBe(false);
    expect(plan.summary).toContain('server');
  });

  it('a frontend beside it is fullstack, not a plain website', () => {
    const plan = planDeployment({ ...app, 'index.html': '<!doctype html><div id=root></div>' });
    expect(plan.shape).toBe('fullstack');
    expect(plan.staticHostingSufficient).toBe(false);
  });

  it('BackendPresence shows the honest banner instead of a silently-broken preview', () => {
    const presence = detectBackendPresence(app);
    expect(presence.hasBackend).toBe(true);
    expect(presence.reason).toContain('server');
  });

  it('the two detectors AGREE — the drift this shared module exists to prevent', () => {
    for (const files of [app, { ...app, 'index.html': '<html></html>' }]) {
      expect(detectBackendPresence(files).hasBackend).toBe(!planDeployment(files).staticHostingSufficient);
    }
  });
});

describe('an ordinary frontend still publishes as a website — no new refusals', () => {
  it('a Vite SPA that fetches over http is still static', () => {
    const plan = planDeployment({
      'package.json': JSON.stringify({ dependencies: { vite: '^5' }, scripts: { build: 'vite build' } }),
      'index.html': '<!doctype html>',
      'src/api.ts': "import http from 'http';\nhttp.get('/x', cb);",
    });
    expect(plan.staticHostingSufficient).toBe(true);
    expect(plan.shape).toBe('spa');
  });

  it('a plain static site is untouched', () => {
    const plan = planDeployment({ 'index.html': '<!doctype html><h1>hi</h1>' });
    expect(plan.shape).toBe('static');
    expect(plan.staticHostingSufficient).toBe(true);
  });
});
