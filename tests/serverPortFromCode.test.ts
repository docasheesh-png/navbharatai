import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { serverListenPort, serverPortFromFiles } from '../src/server/lib/fullstackBootHint';

/**
 * "CLOSED PORT ERROR — no service running on port 3000" (admin 2026-08-23), for an Express app that
 * was running perfectly on 5000.
 *
 * ROOT CAUSE: a server's start script is usually just `node server.js`, with the port living in the
 * CODE as `app.listen(process.env.PORT || 5000)`. The preview asked only `devScriptPort`, which reads
 * `--port N` FLAGS from the script, got null, fell back to a framework guess of 3000, and waited
 * there. The app was up; we were watching the wrong door.
 *
 * The reader already existed — it was private to fullstackBootHint and the preview path had no
 * equivalent. Same class as the 2026-07-04 `--port 5173` incident, in the one place that fix never
 * reached.
 */

describe('serverListenPort — the port a server binds in its own code', () => {
  it('reads the env-with-fallback form, which is what most servers actually write', () => {
    expect(serverListenPort('app.listen(process.env.PORT || 5000)')).toBe(5000);
    expect(serverListenPort('app.listen(Number(process.env.PORT) || 4000, () => {})')).toBe(4000);
  });

  it('reads a named constant', () => {
    expect(serverListenPort('const PORT = 8080;\napp.listen(PORT);')).toBe(8080);
    expect(serverListenPort('export default { PORT: 7000 }')).toBe(7000);
  });

  it('reads a literal listen', () => {
    expect(serverListenPort('server.listen(3333, "0.0.0.0")')).toBe(3333);
  });

  it('returns null when the code declares no port — the caller keeps its own fallback', () => {
    expect(serverListenPort('console.log("hello")')).toBeNull();
    expect(serverListenPort('')).toBeNull();
  });

  it('refuses a nonsense port rather than passing it on', () => {
    expect(serverListenPort('app.listen(999999)')).toBeNull();
  });
});

describe('serverPortFromFiles — find the entry that actually declares one', () => {
  it('🔒 THE REPORTED APP: node server.js with the port in the code', () => {
    const port = serverPortFromFiles({
      'package.json': '{"scripts":{"start":"node server.js"}}',
      'server.js': "const express = require('express');\nconst app = express();\napp.listen(process.env.PORT || 5000);",
    });
    expect(port).toBe(5000);
  });

  it('🔒 server.* is preferred over index.*, and that order is the point', () => {
    // A project with both almost always means server.js is the API and index.js the frontend entry.
    // Reading the frontend's port and waiting on it is the same failure in a new costume.
    const port = serverPortFromFiles({
      'index.js': 'app.listen(3000)',
      'server.js': 'app.listen(5000)',
    });
    expect(port).toBe(5000);
  });

  it('looks inside src/ too', () => {
    expect(serverPortFromFiles({ 'src/server.ts': 'app.listen(4321)' })).toBe(4321);
  });

  it('🔒 null when nothing declares a port — it can only ADD knowledge, never remove it', () => {
    expect(serverPortFromFiles({ 'server.js': 'console.log(1)' })).toBeNull();
    expect(serverPortFromFiles({})).toBeNull();
    expect(serverPortFromFiles(null as never)).toBeNull();
  });

  it('ignores a file that is not a server entry at all', () => {
    expect(serverPortFromFiles({ 'src/components/Thing.tsx': 'const PORT = 9999' })).toBeNull();
  });
});

describe('the preview path uses it, and in the right order', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('🔒 the script flag still WINS — the 2026-07-04 fix is not regressed', () => {
    // A `--port` flag is a deliberate override of whatever the code defaults to, so the code is
    // consulted only where the script is silent, and the framework guess only where both are.
    expect(route).toContain('scriptPort ?? codePort ?? expectedPort');
    expect(route).toContain('if (scriptPort === null)');
  });

  it('reads the code port from the project files', () => {
    expect(route).toContain('serverPortFromFiles(src)');
  });
});
