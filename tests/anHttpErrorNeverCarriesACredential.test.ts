// Forensic audit 2026-10-04 (P1) — an HTTP error object never carries the credential that made the request.
//
// routes/github.ts logged a whole AxiosError on every failed blob fetch; `util.inspect` of one prints
// `config.headers.Authorization` and the raw request header block — the user's repo-scoped GitHub token,
// in the Cloud Run log. The class is closed process-wide by an axios interceptor; this drives a REAL
// failed request against a local server and inspects the error exactly as console.warn would.

import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { inspect } from 'node:util';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import axios from 'axios';
import '../src/server/lib/axiosCredentialRedaction';

const TOKEN = 'ghp_PLANTEDsecret0123456789abcdef';
const server = http.createServer((_req, res) => { res.statusCode = 403; res.end('{"message":"rate limited"}'); }).listen(0);
const url = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/repos/o/r/git/blobs/x`;
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe('a failed request\'s error, printed in full, holds no credential', () => {
  for (const header of ['Authorization', 'X-Client-Secret', 'x-api-key']) {
    it(header, async () => {
      let printed = '';
      try {
        await axios.get(url(), { headers: { [header]: header === 'Authorization' ? `token ${TOKEN}` : TOKEN } });
      } catch (err) {
        printed = inspect(err, { depth: 6 });
        expect((err as { response?: { status?: number } }).response?.status).toBe(403); // the real error survives
      }
      expect(printed.length).toBeGreaterThan(0);
      expect(printed).not.toContain(TOKEN);
    });
  }
});

describe('the server installs it, and the two known call sites log status only', () => {
  it('server.ts imports the redaction', () => {
    expect(readFileSync('server.ts', 'utf8')).toMatch(/import '\.\/src\/server\/lib\/axiosCredentialRedaction';/);
  });

  it('github.ts and cloudsync.ts never print the error object of a blob fetch', () => {
    for (const f of ['src/server/routes/github.ts', 'src/server/routes/cloudsync.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.warn\(`Failed to fetch blob for \$\{item\.path\}:`,\s*\w+\)/);
    }
  });
});
