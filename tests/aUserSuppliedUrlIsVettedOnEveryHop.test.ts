// Forensic audit 2026-10-04 — a URL a user supplied is vetted before the server fetches it, and a redirect
// (an unvetted second hop) is refused. The bot flow's API nodes used the bare global fetch (a bot owner
// could aim one at the cloud metadata server), and the connected-service (MCP) client followed redirects
// with the user's headers after vetting only the first hop.

import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { guardedPublicFetch } from '../src/server/lib/ssrfGuard';

describe('guardedPublicFetch', () => {
  for (const u of ['http://169.254.169.254/computeMetadata/v1/', 'http://127.0.0.1:1/', 'http://metadata.google.internal/', 'file:///etc/passwd', 'http://[::1]/']) {
    it(`refuses ${u} without a network call`, async () => {
      const r = await guardedPublicFetch(u);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    });
  }
});

describe('callers', () => {
  it('the bot flow runner is handed the guarded fetch, never the global one', () => {
    const src = readFileSync('src/server/routes/bots.ts', 'utf8');
    expect(src).not.toMatch(/runBotTurn\([^)]*globalThis\.fetch/);
    expect((src.match(/runBotTurn\([^)]*guardedPublicFetch\)/g) ?? []).length).toBe(2);
  });

  it('the MCP client refuses redirects', () => {
    expect(readFileSync('src/server/AgentV3/mcpTransport.ts', 'utf8')).toMatch(/redirect: 'error'/);
  });
});

describe('a redirect is never followed', () => {
  const server = http.createServer((_q, r) => { r.statusCode = 302; r.setHeader('location', 'http://169.254.169.254/'); r.end(); }).listen(0);
  afterAll(() => new Promise<void>((done) => server.close(() => done())));
  it('fetch with redirect:error rejects a 302 (the mechanism the guard relies on)', async () => {
    await expect(fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, { redirect: 'error' })).rejects.toThrow();
  });
});
