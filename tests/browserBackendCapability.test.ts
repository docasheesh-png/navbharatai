import { describe, it, expect } from 'vitest';
import {
  proveBackendRunnable, findServerEntry, bareImports, packageName, serverModuleGraph,
} from '../src/server/runtime/browserBackend/capability';

/**
 * PHASE 2 slice 1 — the gate.
 *
 * `expressShim.ts` can genuinely run an Express app's route handlers. It cannot run everything an
 * Express app might do, and the difference between those two sentences is where a "built but not really
 * working" feature would be born.
 *
 * So the property these tests exist to protect is ONE property: **the default answer is NO.** Not "does
 * anything look unsupported?" but "is EVERY import on the supported list?" — one unknown name and the
 * whole app goes to the sandbox.
 *
 * A wrong NO costs one sandbox: today's cost, no regression, nobody notices. A wrong YES silently
 * answers a user's API calls with something that is not their server, while the app looks like it works.
 */

const server = (body: string) => ({
  'package.json': JSON.stringify({ dependencies: { express: '^4.19.0' } }),
  'server/index.js': body,
});

describe('the case this was built for', () => {
  it('an in-memory Express CRUD server is runnable', () => {
    const c = proveBackendRunnable(server(`
      const express = require('express');
      const cors = require('cors');
      const app = express();
      app.use(cors());
      app.use(express.json());
      let items = [];
      app.get('/api/items', (req, res) => res.json(items));
      app.listen(3000);
    `));
    expect(c.runnable).toBe(true);
    expect(c.entry).toBe('server/index.js');
    expect(c.blockers).toEqual([]);
  });

  it('follows RELATIVE imports, so a blocker hiding in a route file is still found', () => {
    // The realistic shape: index.js looks clean, and the disqualifying import is one file deeper.
    const c = proveBackendRunnable({
      ...server(`const express = require('express'); const routes = require('./routes'); const app = express(); app.use(routes);`),
      'server/routes.js': `const { Pool } = require('pg'); module.exports = null;`,
    });
    expect(c.runnable).toBe(false);
    expect(c.blockers).toContain('needs-database');
    expect(c.unsupported).toContain('pg');
  });
});

describe('the default is NO', () => {
  it('ONE unknown import refuses the whole app', () => {
    const c = proveBackendRunnable(server(`
      const express = require('express');
      const stripe = require('stripe');
      const app = express();
    `));
    expect(c.runnable).toBe(false);
    expect(c.blockers).toContain('unsupported-import');
    expect(c.unsupported).toContain('stripe');
  });

  it('a database is refused and SAYS it is a database', () => {
    // A specific reason is what lets the user act on it; "unsupported" alone teaches them nothing.
    const c = proveBackendRunnable(server(`const express = require('express'); const { Pool } = require('pg');`));
    expect(c.blockers).toContain('needs-database');
    expect(c.reason).toContain('database');
  });

  it('machine access is refused', () => {
    for (const mod of ['fs', 'child_process', 'multer', 'node-cron', 'ws']) {
      const c = proveBackendRunnable(server(`const express = require('express'); const m = require('${mod}');`));
      expect(c.blockers, mod).toContain('needs-machine');
    }
  });

  it('bcryptjs passes and bcrypt does NOT — three characters apart', () => {
    /**
     * The pair that most deserves its own test. `bcryptjs` is pure JavaScript and runs in a browser
     * unchanged; `bcrypt` is a native binding that cannot exist there. They differ by three characters
     * and by whether the app runs at all.
     */
    expect(proveBackendRunnable(server(`const express=require('express');const b=require('bcryptjs');`)).runnable).toBe(true);
    expect(proveBackendRunnable(server(`const express=require('express');const b=require('bcrypt');`)).runnable).toBe(false);
  });

  it('no server entry at all is a refusal, not a pass', () => {
    // "Found no problems" and "proved it works" are different sentences, and only the second may
    // return true. An app with no server must never fall through to runnable.
    const c = proveBackendRunnable({ 'src/App.tsx': 'export default () => null;' });
    expect(c.runnable).toBe(false);
    expect(c.blockers).toEqual(['no-server-entry']);
  });

  it('empty and malformed inputs refuse', () => {
    for (const input of [{}, null, undefined]) {
      expect(proveBackendRunnable(input as never).runnable).toBe(false);
    }
  });

  it('a "server" that never imports express is refused even when everything else is clean', () => {
    // Nothing here is on a blocklist — and that is exactly why this check exists. The shim cannot claim
    // to run a server it does not recognise as one.
    const c = proveBackendRunnable({
      'package.json': '{}',
      'server/index.js': `const zod = require('zod'); const dayjs = require('dayjs');`,
    });
    expect(c.runnable).toBe(false);
    expect(c.blockers).toContain('unsupported-import');
  });

  it('every blocker is collected, not just the first', () => {
    const c = proveBackendRunnable(server(`
      const express = require('express');
      const { Pool } = require('pg');
      const fs = require('fs');
      const stripe = require('stripe');
    `));
    expect(c.blockers.length).toBeGreaterThan(2);
    expect(c.unsupported).toEqual(expect.arrayContaining(['pg', 'fs', 'stripe']));
  });
});

describe('finding the server, and not mistaking a client for one', () => {
  it('src/api/client.ts is a fetch helper, NOT a server', () => {
    // Same rule serverNecessity.ts uses, so the two cannot disagree about what a server is. Treating
    // this as a backend would have us "run" a file that never was one.
    expect(findServerEntry({ 'src/api/index.ts': `import express from 'express';` })).toBeNull();
  });

  it('a root server.js counts only when it actually imports express', () => {
    expect(findServerEntry({ 'server.js': `const express = require('express');` })).toBe('server.js');
    expect(findServerEntry({ 'app.js': `console.log('hello');` })).toBeNull();
  });

  it('prefers the shallowest entry when several match', () => {
    const files = { 'server/index.js': 'x', 'server/legacy/deep/index.js': 'x' };
    expect(findServerEntry(files)).toBe('server/index.js');
  });
});

describe('the import reader', () => {
  it('reads every form generated code actually uses', () => {
    expect(bareImports(`
      import express from 'express';
      import { z } from 'zod';
      const cors = require('cors');
      const lazy = await import('dayjs');
      import './local.css';
      import '../relative';
    `)).toEqual(['cors', 'dayjs', 'express', 'zod']);
  });

  it('reduces a deep specifier to its package', () => {
    expect(packageName('lodash/get')).toBe('lodash');
    expect(packageName('@prisma/client/edge')).toBe('@prisma/client');
    expect(packageName('node:fs/promises')).toBe('fs');
  });

  it('a cyclic import graph terminates instead of hanging', () => {
    // Route → controller → route is ordinary in Express apps. An unbounded walk over it is a hang
    // rather than a verdict, and a gate that hangs is a gate that gets removed.
    const files = {
      'server/index.js': `require('./a');`,
      'server/a.js': `require('./b');`,
      'server/b.js': `require('./a');`,
    };
    expect(serverModuleGraph(files, 'server/index.js').sort()).toEqual(['server/a.js', 'server/b.js', 'server/index.js']);
  });

  it('resolves ../ and directory index files', () => {
    const files = {
      'server/index.js': `require('../shared/util'); require('./routes');`,
      'shared/util.js': 'x',
      'server/routes/index.js': 'x',
    };
    expect(serverModuleGraph(files, 'server/index.js')).toContain('shared/util.js');
    expect(serverModuleGraph(files, 'server/index.js')).toContain('server/routes/index.js');
  });
});

describe('the refusal message', () => {
  it('names no vendor and no model — the white-label law holds here too', () => {
    const c = proveBackendRunnable(server(`const express=require('express');const {Pool}=require('pg');`));
    expect(c.reason).not.toMatch(/\b(E2B|GLM|Kimi|Claude|Anthropic|Gemini|Grok|Postgres|Express)\b/i);
    expect(c.reason.length).toBeGreaterThan(10);
  });

  it('is empty exactly when the app is runnable', () => {
    expect(proveBackendRunnable(server(`const express=require('express');`)).reason).toBe('');
    expect(proveBackendRunnable({}).reason).not.toBe('');
  });
});
