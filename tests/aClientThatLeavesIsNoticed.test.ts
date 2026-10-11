// Q-621 (forensic audit 2026-10-04) — a streaming route must learn that its client has gone.
//
// Four streaming POST routes listened for `req.on('close')`. After `express.json()` has read the body,
// a request's 'close' has already been emitted, so a listener a handler attaches later never fires — the
// chat's "cancel the upstream AI call when the client leaves" had never cancelled anything. These tests
// run a real Express app with the real body parser and a real socket that disconnects mid-stream.

import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { onClientGone, onStreamClosed } from '../src/server/lib/clientDisconnect';

const seen: Record<string, string[]> = {};
const app = express();
app.use(express.json());
// The shape every one of the four routes has: an await (auth, lookups), THEN the stream.
app.post('/stream/:id', async (req, res) => {
  const id = req.params.id;
  seen[id] = [];
  await new Promise((r) => setTimeout(r, 30));
  req.on('close', () => seen[id].push('req-close'));        // the old listener, for contrast
  onClientGone(res, () => seen[id].push('gone'));
  onStreamClosed(res, () => seen[id].push('closed'));
  res.write('first\n');
  if (req.body?.finish) res.end('done\n');
});
const server = app.listen(0);
const port = () => (server.address() as AddressInfo).port;
afterAll(() => new Promise<void>((done) => server.close(() => done())));

function post(id: string, body: object, disconnectAfterFirstChunk: boolean): Promise<void> {
  return new Promise((resolve) => {
    const r = http.request({ port: port(), method: 'POST', path: `/stream/${id}`, headers: { 'content-type': 'application/json' } }, (resp) => {
      resp.once('data', () => { if (disconnectAfterFirstChunk) { r.destroy(); setTimeout(resolve, 150); } });
      resp.on('end', () => setTimeout(resolve, 50));
    });
    r.on('error', () => { /* our own destroy */ });
    r.end(JSON.stringify(body));
  });
}

describe('a streaming POST notices a client that leaves', () => {
  it('disconnect mid-stream → onClientGone and onStreamClosed fire; the old req listener does not', async () => {
    await post('left', { q: 1 }, true);
    expect(seen.left).toContain('gone');
    expect(seen.left).toContain('closed');
    expect(seen.left).not.toContain('req-close'); // the reason the four routes never noticed
  });

  it('a stream that finished normally is not a client that left', async () => {
    await post('finished', { finish: true }, false);
    expect(seen.finished).toContain('closed');
    expect(seen.finished).not.toContain('gone');
  });
});

describe('census: no server code listens for a request\'s close', () => {
  const files: string[] = ['server.ts'];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n) && !/\.test\./.test(n)) files.push(p); } };
  walk('src/server');
  it('every disconnect listener goes through clientDisconnect.ts', () => {
    const code = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    // Old assertion: every req.on/once('close') is an offender (expected []).
    // BLD-4 added one raw listener in zipUpload.ts. That route streams the body itself
    // (no express.json), and req.destroy() on an oversize chunk emits close/aborted rather
    // than end. The listener only settles the promise so the handler can answer 413. It is
    // not a post-parse "client left" subscription. Any other file, or a second listener
    // in that file, is still an offender.
    const ZIP_CAP = 'src/server/routes/zipUpload.ts';
    const offenders = files.filter((f) => {
      const hits = code(f).match(/\breq\.(on|once)\(\s*['"`]close['"`]/g) ?? [];
      if (f.endsWith(ZIP_CAP)) return hits.length !== 1;
      return hits.length > 0;
    });
    expect(offenders).toEqual([]);
    const zip = code(ZIP_CAP);
    expect(zip).toContain("req.on('close', () => finish());");
    expect(zip).toContain("req.on('aborted', () => finish());");
    expect(zip).toContain("req.destroy(new Error('chunk too large'))");
  });
});
