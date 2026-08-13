import { describe, it, expect } from 'vitest';
import { EXPRESS_SHIM_SOURCE, EXPRESS_SHIM_PATH, BACKEND_BRIDGE_PATH } from '../src/server/runtime/browserBackend/expressShim';

/**
 * PHASE 2 slice 1 — the app's OWN Express routes, executed in the browser.
 *
 * These tests RUN the shipped source. Not "the string contains app.get", not "the options object has
 * the right shape" — the real module is instantiated and real requests are dispatched through it, so
 * what is verified is what a user's app will actually meet.
 *
 * 🔒 THE LINE THAT MAKES THIS LEGAL UNDER THE SECOND ABSOLUTE RULE: this is not a mock server and must
 * never become one. It invents no responses. It runs the handlers the user wrote — what is shimmed is
 * the FRAMEWORK around them (routing, params, body parsing), which is the part Express itself would
 * run. Anything it cannot do faithfully must be REFUSED by the capability prover, sending the whole app
 * to the sandbox, rather than approximated here.
 */

type Res = { status: number; headers: Record<string, string>; body: string };
interface App {
  get: (...a: unknown[]) => App; post: (...a: unknown[]) => App; put: (...a: unknown[]) => App;
  delete: (...a: unknown[]) => App; use: (...a: unknown[]) => App; listen: (...a: unknown[]) => { close: () => void };
  __nbaiHandle: (m: string, url: string, h?: Record<string, string>, b?: string) => Promise<Res>;
}
interface Express { (): App; Router: () => App; json: () => unknown; urlencoded: () => unknown; static: () => unknown }

/** Instantiate the SHIPPED source exactly as the preview's module loader would. */
function loadExpress(): Express {
  const module = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', EXPRESS_SHIM_SOURCE)(module, module.exports);
  return module.exports as unknown as Express;
}

const express = loadExpress();
const json = (r: Res) => JSON.parse(r.body);

describe('routing — the part a real app leans on hardest', () => {
  it('dispatches a GET to the handler the user wrote', async () => {
    const app = express();
    app.get('/api/items', (_req: unknown, res: { json: (b: unknown) => void }) => res.json([{ id: 1 }]));
    const r = await app.__nbaiHandle('GET', '/api/items');
    expect(r.status).toBe(200);
    expect(json(r)).toEqual([{ id: 1 }]);
  });

  it('binds :params, URI-decoded', async () => {
    const app = express();
    app.get('/api/items/:id', (req: { params: Record<string, string> }, res: { json: (b: unknown) => void }) => res.json(req.params));
    expect(json(await app.__nbaiHandle('GET', '/api/items/42'))).toEqual({ id: '42' });
    expect(json(await app.__nbaiHandle('GET', '/api/items/a%20b'))).toEqual({ id: 'a b' });
  });

  it('parses the query string, collapsing repeats into an array like Express does', async () => {
    const app = express();
    app.get('/api/search', (req: { query: unknown }, res: { json: (b: unknown) => void }) => res.json(req.query));
    expect(json(await app.__nbaiHandle('GET', '/api/search?q=milk&page=2'))).toEqual({ q: 'milk', page: '2' });
    expect(json(await app.__nbaiHandle('GET', '/api/search?tag=a&tag=b'))).toEqual({ tag: ['a', 'b'] });
  });

  it('does not confuse methods, or a longer path with a shorter one', async () => {
    const app = express();
    app.get('/api/x', (_q: unknown, res: { json: (b: unknown) => void }) => res.json({ via: 'get' }));
    app.post('/api/x', (_q: unknown, res: { json: (b: unknown) => void }) => res.json({ via: 'post' }));
    expect(json(await app.__nbaiHandle('POST', '/api/x'))).toEqual({ via: 'post' });
    // '/api/x/y' must NOT match '/api/x' — a prefix match here would route half an app to the wrong place.
    expect((await app.__nbaiHandle('GET', '/api/x/y')).status).toBe(404);
  });

  it('an unmatched route is a REAL 404, the way Express ends a request nobody claimed', async () => {
    const app = express();
    app.get('/api/known', (_q: unknown, res: { json: (b: unknown) => void }) => res.json({}));
    const r = await app.__nbaiHandle('GET', '/api/unknown');
    expect(r.status).toBe(404);
    expect(r.body).toContain('Cannot GET /api/unknown');
  });
});

describe('middleware, routers and mounting', () => {
  it('express.json() parses a real body', async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/items', (req: { body: unknown }, res: { status: (c: number) => { json: (b: unknown) => void } }) => res.status(201).json(req.body));
    const r = await app.__nbaiHandle('POST', '/api/items', { 'content-type': 'application/json' }, '{"name":"Doodh"}');
    expect(r.status).toBe(201);
    expect(json(r)).toEqual({ name: 'Doodh' });
  });

  it('a MALFORMED body is a real 400 — not a silent empty object', async () => {
    // Swallowing this would let a broken client look like a working one, which is the "built but not
    // really working" state in miniature.
    const app = express();
    app.use(express.json());
    app.post('/api/items', (_q: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
    expect((await app.__nbaiHandle('POST', '/api/items', { 'content-type': 'application/json' }, '{oops')).status).toBe(400);
  });

  it('a mounted Router serves its routes under the base', async () => {
    const app = express();
    const router = express.Router();
    router.get('/:id', (req: { params: Record<string, string> }, res: { json: (b: unknown) => void }) => res.json({ id: req.params.id }));
    app.use('/api/products', router);
    expect(json(await app.__nbaiHandle('GET', '/api/products/7'))).toEqual({ id: '7' });
    expect((await app.__nbaiHandle('GET', '/api/other/7')).status).toBe(404);
  });

  it('middleware runs in order and next() continues the chain', async () => {
    const app = express();
    const seen: string[] = [];
    app.use((_q: unknown, _r: unknown, next: () => void) => { seen.push('one'); next(); });
    app.use((_q: unknown, _r: unknown, next: () => void) => { seen.push('two'); next(); });
    app.get('/api/z', (_q: unknown, res: { json: (b: unknown) => void }) => { seen.push('handler'); res.json({}); });
    await app.__nbaiHandle('GET', '/api/z');
    expect(seen).toEqual(['one', 'two', 'handler']);
  });

  it('middleware that ends the response stops the chain (an auth guard really guards)', async () => {
    const app = express();
    app.use((_q: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => { res.status(401).json({ error: 'no' }); });
    app.get('/api/secret', (_q: unknown, res: { json: (b: unknown) => void }) => res.json({ leaked: true }));
    const r = await app.__nbaiHandle('GET', '/api/secret');
    expect(r.status).toBe(401);
    expect(json(r)).toEqual({ error: 'no' });
  });
});

describe('errors are reported, never swallowed', () => {
  it('a THROWN handler becomes a 500 carrying its real message', async () => {
    const app = express();
    app.get('/api/boom', () => { throw new Error('db is down'); });
    const r = await app.__nbaiHandle('GET', '/api/boom');
    expect(r.status).toBe(500);
    expect(json(r).error).toBe('db is down');
  });

  it('a REJECTED async handler does the same', async () => {
    const app = express();
    app.get('/api/boom', async () => { throw new Error('await failed'); });
    expect(json(await app.__nbaiHandle('GET', '/api/boom')).error).toBe('await failed');
  });

  it('a 4-argument error middleware gets the error and can answer it', async () => {
    const app = express();
    app.get('/api/boom', (_q: unknown, _r: unknown, next: (e: Error) => void) => next(new Error('nope')));
    app.use((err: Error, _q: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, _n: unknown) => res.status(418).json({ caught: err.message }));
    const r = await app.__nbaiHandle('GET', '/api/boom');
    expect(r.status).toBe(418);
    expect(json(r)).toEqual({ caught: 'nope' });
  });

  it('an async handler is awaited before the response is read', async () => {
    const app = express();
    app.get('/api/slow', async (_q: unknown, res: { json: (b: unknown) => void }) => {
      await new Promise((r) => setTimeout(r, 5));
      res.json({ late: true });
    });
    expect(json(await app.__nbaiHandle('GET', '/api/slow'))).toEqual({ late: true });
  });
});

describe('the shapes a generated server actually produces', () => {
  it('app.listen still calls its callback — the last line of almost every generated server', async () => {
    // There is no socket to bind in a browser. Throwing here would kill the module on its final line,
    // after every route was registered correctly.
    const app = express();
    let called = false;
    const server = app.listen(3000, () => { called = true; });
    expect(called).toBe(true);
    expect(() => server.close()).not.toThrow();
  });

  it('app.get(name) still reads a SETTING, not a route — Express overloads it', async () => {
    const app = express() as unknown as { set: (k: string, v: unknown) => void; get: (k: string) => unknown };
    app.set('port', 3000);
    expect(app.get('port')).toBe(3000);
  });

  it('a full CRUD store behaves end to end', async () => {
    // The dukaan shape: add an item, list it back, then delete it. If any of routing, params, body
    // parsing or status codes were wrong, this would fail somewhere in the middle.
    const app = express();
    const items: Array<{ id: number; name: string }> = [];
    app.use(express.json());
    app.get('/api/items', (_q: unknown, res: { json: (b: unknown) => void }) => res.json(items));
    app.post('/api/items', (req: { body: { name: string } }, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      const item = { id: items.length + 1, name: req.body.name };
      items.push(item);
      res.status(201).json(item);
    });
    app.delete('/api/items/:id', (req: { params: Record<string, string> }, res: { sendStatus: (c: number) => void }) => {
      const i = items.findIndex((x) => String(x.id) === req.params.id);
      if (i >= 0) items.splice(i, 1);
      res.sendStatus(204);
    });

    expect(json(await app.__nbaiHandle('POST', '/api/items', { 'content-type': 'application/json' }, '{"name":"Doodh"}'))).toEqual({ id: 1, name: 'Doodh' });
    expect(json(await app.__nbaiHandle('GET', '/api/items'))).toEqual([{ id: 1, name: 'Doodh' }]);
    expect((await app.__nbaiHandle('DELETE', '/api/items/1')).status).toBe(204);
    expect(json(await app.__nbaiHandle('GET', '/api/items'))).toEqual([]);
  });

  it('express.static is an honest no-op, not a pretend file server', async () => {
    // There is no disk. Passing through is truthful — nothing is claimed to be served. Inventing file
    // contents would not be.
    const app = express();
    app.use(express.static());
    app.get('/api/ping', (_q: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
    expect(json(await app.__nbaiHandle('GET', '/api/ping'))).toEqual({ ok: true });
  });
});

describe('the module contract the preview loader depends on', () => {
  it('is importable both ways, since generated code uses both', () => {
    expect(typeof express).toBe('function');
    expect((express as unknown as { default: unknown }).default).toBe(express);
    expect((express as unknown as { __esModule: boolean }).__esModule).toBe(true);
  });

  it('mounts at stable virtual paths', () => {
    expect(EXPRESS_SHIM_PATH).toBe('__nbai/express.js');
    expect(BACKEND_BRIDGE_PATH).toBe('__nbai/backend-bridge.js');
  });
});
