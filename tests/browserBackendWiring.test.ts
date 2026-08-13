import { describe, it, expect } from 'vitest';
import { buildReactPreview } from '../src/server/runtime/ReactPreview';
import { EXPRESS_SHIM_PATH, BACKEND_BRIDGE_PATH } from '../src/server/runtime/browserBackend/expressShim';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

/**
 * PHASE 2 slice 2 — the wiring, proved on the page the server actually emits.
 *
 * Slice 1 proved the Express shim runs route handlers. That is not the same as proving a real preview
 * PAGE boots a real server and answers a real fetch, and the gap between those two is where wiring bugs
 * live. So these tests read the emitted document and, for the end-to-end case, execute its payload.
 *
 * The property that matters most is the NEGATIVE one: an app the prover refuses must produce a page
 * byte-for-byte identical to today's. The whole feature is opt-in by proof, so "nothing happens" is the
 * behaviour almost every app must keep.
 */

const vfs = (files: Record<string, string>) => VirtualFileSystem.fromRecord(files);

const FRONTEND = {
  'package.json': JSON.stringify({ dependencies: { express: '^4.19.0', react: '^18.3.1' } }),
  'index.html': '<div id="root"></div>',
  'src/main.jsx': "export default function App() { return <h1>hi</h1>; }",
};

const RUNNABLE_SERVER = `
  const express = require('express');
  const app = express();
  app.use(express.json());
  let items = [{ id: 1, name: 'Doodh' }];
  app.get('/api/items', (req, res) => res.json(items));
  app.post('/api/items', (req, res) => { items.push({ id: items.length + 1, name: req.body.name }); res.status(201).json(items[items.length - 1]); });
  app.listen(3000, () => console.log('up'));
`;

describe('an app whose backend can be proved', () => {
  const html = buildReactPreview(vfs({ ...FRONTEND, 'server/index.js': RUNNABLE_SERVER }));

  it('ships the shim and the bridge in the page', () => {
    expect(html).toContain(EXPRESS_SHIM_PATH);
    expect(html).toContain(BACKEND_BRIDGE_PATH);
  });

  it('names the server entry so the loader knows what to run', () => {
    expect(html).toContain('"backendEntry":"server/index.js"');
  });

  it('routes the bare specifier `express` to the shim, not to the CDN', () => {
    // Without this the server module would import a real Express from the dependency mirror, which
    // cannot run in a browser — the app would die on its first line instead of serving.
    expect(html).toContain("ALIASES['express']");
  });

  it('runs the server BEFORE the frontend mounts', () => {
    // A component fetching on mount would otherwise race the server meant to answer it. Order is the
    // whole correctness argument here, so it is asserted as order, not as presence.
    const server = html.indexOf('requireModule(BACKEND_ENTRY)');
    const frontend = html.indexOf('requireModule(ENTRY)');
    expect(server).toBeGreaterThan(0);
    expect(frontend).toBeGreaterThan(server);
  });
});

describe('an app whose backend CANNOT be proved — the page must be unchanged', () => {
  /**
   * The negative case carries more weight than the positive one. Almost every app that has ever been
   * built here must keep exactly the page it has today, and the prover's default is what guarantees it.
   */
  // `pg` is deliberately NOT the example here: it became supported when pgShim.ts landed. A refusal
  // fixture has to use something the prover still refuses, or it silently stops testing a refusal.
  const withDatabase = buildReactPreview(vfs({
    ...FRONTEND,
    'server/index.js': `const express = require('express'); const mongoose = require('mongoose'); const app = express();`,
  }));

  it('ships no shim, no bridge, no backend entry', () => {
    expect(withDatabase).not.toContain(EXPRESS_SHIM_PATH);
    expect(withDatabase).not.toContain(BACKEND_BRIDGE_PATH);
    expect(withDatabase).toContain('"backendEntry":null');
  });

  it('a plain frontend app is untouched', () => {
    const plain = buildReactPreview(vfs(FRONTEND));
    expect(plain).toContain('"backendEntry":null');
    expect(plain).not.toContain(EXPRESS_SHIM_PATH);
  });
});

describe('END TO END — the emitted payload really serves a fetch', () => {
  /**
   * The test that makes the rest of them worth anything: take the module map the SERVER emitted, run
   * the bridge and the server module through a loader shaped like the browser's, and then call the
   * patched `fetch` the way the user's React component would.
   *
   * If the alias, the boot order, the app-instance handoff or the response construction were wrong,
   * this is where it shows — none of the assertions above would have caught any of them.
   */
  function bootPayload(html: string): { fetch: (u: string, i?: RequestInit) => Promise<Response> } {
    const m = html.match(/<script type="application\/json" id="__bundle__">([\s\S]*?)<\/script>/)
      || html.match(/JSON\.parse\('(.*)'\)/);
    // The React preview embeds its payload as a JS object literal in the loader; pull it out of the
    // rendered document the same way the browser would receive it.
    const payloadMatch = html.match(/var bundle = (\{[\s\S]*?\});\n/) || null;
    const raw = m ? m[1] : payloadMatch ? payloadMatch[1] : null;
    expect(raw, 'the page must carry a module payload').toBeTruthy();
    const bundle = JSON.parse(raw!) as { modules: Record<string, string>; backendEntry: string | null };

    // A loader shaped like the preview's: CommonJS modules, relative + aliased resolution.
    const cache: Record<string, { exports: Record<string, unknown> }> = {};
    const win: Record<string, unknown> = { fetch: () => Promise.reject(new Error('network')), Response };
    const req = (path: string): Record<string, unknown> => {
      const key = path.replace(/^\//, '');
      const resolved = bundle.modules[key] !== undefined ? key
        : bundle.modules[`${key}.js`] !== undefined ? `${key}.js` : key;
      if (cache[resolved]) return cache[resolved].exports;
      const src = bundle.modules[resolved];
      if (src === undefined) throw new Error(`module not found: ${resolved}`);
      const mod = { exports: {} as Record<string, unknown> };
      cache[resolved] = mod;
      const local = (spec: string): unknown => {
        if (spec === 'express') return req(EXPRESS_SHIM_PATH);
        if (spec.startsWith('.')) {
          const dir = resolved.includes('/') ? resolved.slice(0, resolved.lastIndexOf('/')) : '';
          return req(`${dir}/${spec.replace(/^\.\//, '')}`);
        }
        return req(spec);
      };
      // `fetch` is shadowed as a parameter so the bridge's capture of the page's own fetch picks up
      // THIS stub, not Node's real global — a unit test must never make a network request to prove a
      // passthrough happened.
      new Function('require', 'module', 'exports', 'window', 'Response', 'fetch', src)(local, mod, mod.exports, win, Response, win.fetch);
      return mod.exports;
    };

    const bridge = req(BACKEND_BRIDGE_PATH) as { register: (a: unknown) => void };
    req(bundle.backendEntry!);
    const expressMod = req(EXPRESS_SHIM_PATH) as unknown as { __nbaiLastApp: unknown };
    bridge.register(expressMod.__nbaiLastApp);
    return { fetch: win.fetch as (u: string, i?: RequestInit) => Promise<Response> };
  }

  const html = buildReactPreview(vfs({ ...FRONTEND, 'server/index.js': RUNNABLE_SERVER }));

  it('GET /api/items is answered by the user\'s own handler', async () => {
    const { fetch } = bootPayload(html);
    const res = await fetch('/api/items');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1, name: 'Doodh' }]);
  });

  it('POST round-trips through the user\'s own state', async () => {
    const { fetch } = bootPayload(html);
    const created = await fetch('/api/items', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Chawal' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: 2, name: 'Chawal' });
    // The proof it is REAL state and not a canned answer: the next GET sees the write.
    expect(await (await fetch('/api/items')).json()).toEqual([{ id: 1, name: 'Doodh' }, { id: 2, name: 'Chawal' }]);
  });

  it('an unknown route gets the app\'s own honest 404', async () => {
    const { fetch } = bootPayload(html);
    expect((await fetch('/api/nope')).status).toBe(404);
  });

  it('an ABSOLUTE url is passed through, not swallowed', async () => {
    // A third-party integration (a hosted database, an image CDN) must keep reaching the network.
    // Quietly intercepting those would turn a working integration into a mystery. The stub rejects
    // with 'network', so reaching it is the proof — and no real request is made.
    const { fetch } = bootPayload(html);
    await expect(fetch('https://example.com/api/items')).rejects.toThrow('network');
  });

  it('a RELATIVE non-api path is passed through too', async () => {
    // The bridge claims paths beginning with '/'. A document-relative fetch ('data.json') is not the
    // app's API surface and must keep its old behaviour.
    const { fetch } = bootPayload(html);
    await expect(fetch('data.json')).rejects.toThrow('network');
  });
});

describe('the database is shipped only when the server actually uses one', () => {
  /**
   * PGlite is a multi-megabyte WebAssembly download. Shipping it to an app that never queries would
   * tax the very thing this preview exists for — the speed the user feels — so its presence is tied to
   * a real `pg` import, not to "there is a backend".
   */
  const PG_SERVER = `
    const express = require('express');
    const { Pool } = require('pg');
    const app = express();
    const pool = new Pool();
    app.get('/api/items', async (req, res) => res.json((await pool.query('SELECT * FROM items')).rows));
  `;

  it('a pg-using server ships the database shim and aliases `pg`', () => {
    const html = buildReactPreview(vfs({ ...FRONTEND, 'server/index.js': PG_SERVER }), undefined, 'agentv3-alice-s1');
    expect(html).toContain('__nbai/pg.js');
    expect(html).toContain("ALIASES['pg']");
  });

  it('an in-memory server ships NO database at all', () => {
    const html = buildReactPreview(vfs({ ...FRONTEND, 'server/index.js': RUNNABLE_SERVER }));
    expect(html).not.toContain('__nbai/pg.js');
  });

  it('the database is namespaced per workspace, so two apps never share rows', () => {
    const a = buildReactPreview(vfs({ ...FRONTEND, 'server/index.js': PG_SERVER }), undefined, 'agentv3-alice-s1');
    const b = buildReactPreview(vfs({ ...FRONTEND, 'server/index.js': PG_SERVER }), undefined, 'agentv3-alice-s2');
    expect(a).toContain('idb://nbai-pg-agentv3-alice-s1');
    expect(b).toContain('idb://nbai-pg-agentv3-alice-s2');
  });

  it('without a workspace it is memory-only, and SAYS so', () => {
    // Losing data on reload is a real limitation. Stating it in the console is what keeps it a known
    // limitation rather than a bug the user discovers by losing their work.
    const html = buildReactPreview(vfs({ ...FRONTEND, 'server/index.js': PG_SERVER }));
    expect(html).toContain('memory-only');
  });
});
