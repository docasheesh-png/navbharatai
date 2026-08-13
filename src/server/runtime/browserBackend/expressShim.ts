// PHASE 2 slice 1 — run the app's OWN Express routes inside the preview.
//
// ADMIN: the dukaan stock app needed a whole Linux VM for login / list / search / photo / total. The
// server-necessity measurement then said 88% of builds needed no server at all, and the 12 that were
// GIVEN one anyway are pure waste. This is the piece that lets those 12 stop needing a VM: the user's
// own route handlers execute, in the browser, against the same request objects Express would hand them.
//
// ⚠️ A CORRECTION TO THE PLAN (IN_BROWSER_PREVIEW_PLAN.md §3 Phase 2a said "a Service Worker"). It
// cannot be a Service Worker. The preview is an `<iframe srcDoc>`, which has an OPAQUE origin, and
// `navigator.serviceWorker.register()` requires a secure same-origin scope — it would throw there every
// time. `fetch` is patched inside the preview document instead, which is strictly better here anyway:
// no registration lifecycle, no scope rules, no cached worker to invalidate, and nothing that outlives
// the iframe. The plan doc is corrected rather than the mechanism forced.
//
// 🔒 THIS IS NOT A MOCK SERVER, AND MUST NEVER BECOME ONE. It does not invent responses. It runs the
// handlers the user wrote; if their handler returns 404, the app sees 404. What is shimmed is the
// FRAMEWORK around those handlers (routing, params, body parsing) — the same code Express itself would
// run. The moment we cannot support something faithfully, `proveBackendRunnable` refuses the whole app
// and it goes to the sandbox, where the real Express is.
//
// The shim ships as JS SOURCE (not a compiled TS module) because it is injected into the preview's own
// module map and executed by the same loader that runs the user's files — so it is just another module
// to them, resolvable as the bare specifier `express`. Tests execute this exact string, so what is
// verified is what ships.

/** The virtual module path the shim is mounted at inside the preview's file map. */
export const EXPRESS_SHIM_PATH = '__nbai/express.js';

/** The virtual module path of the fetch bridge that connects the app's `fetch` to the shim. */
export const BACKEND_BRIDGE_PATH = '__nbai/backend-bridge.js';

/**
 * A minimal but FAITHFUL Express. Every behaviour here is one Express really has:
 *
 *  • `app.use(fn)` / `app.use('/base', router)` — mounting, with the base stripped before matching
 *  • `app.get|post|put|patch|delete|all(path, ...handlers)` and `express.Router()`
 *  • `:param` and `*` path segments → `req.params`, with URI decoding
 *  • `req.query` (repeat keys become arrays, as `qs` does), `req.body`, `req.headers`, `req.method`
 *  • `express.json()` / `express.urlencoded()` — real parsers, and a malformed body is a real 400
 *  • `res.status().json()`, `.send()`, `.sendStatus()`, `.set()`, `.type()`, `.end()`, `.redirect()`
 *  • `next()` chaining, `next(err)` and 4-argument error middleware
 *  • an unmatched route producing a genuine 404, exactly as Express's final handler does
 *
 * `app.listen(port, cb)` is a NO-OP that still calls the callback: there is no socket to bind in a
 * browser, but a generated server almost always ends with it and would otherwise throw on the last
 * line. It returns a server object with a `close()` so `server.close()` does not crash either.
 */
export const EXPRESS_SHIM_SOURCE = String.raw`
'use strict';

/** Split a path into segments, ignoring empty ones so '/a//b/' and '/a/b' match identically. */
function segments(p) { return String(p || '/').split('?')[0].split('/').filter(Boolean); }

/**
 * Match a route pattern against a path. Returns the params object, or null when it does not match.
 * Supports ':name' and a trailing '*'. Deliberately NOT a regex-from-string: building regexes out of
 * user route strings is how a stray '(' in a path becomes an unexplainable crash.
 */
function matchPath(pattern, path) {
  if (pattern === '*' || pattern === '/*') return {};
  var pp = segments(pattern), sp = segments(path), params = {};
  for (var i = 0; i < pp.length; i++) {
    var seg = pp[i];
    if (seg === '*') return params;                       // trailing wildcard swallows the rest
    if (i >= sp.length) return null;
    if (seg.charAt(0) === ':') {
      try { params[seg.slice(1)] = decodeURIComponent(sp[i]); } catch (e) { params[seg.slice(1)] = sp[i]; }
      continue;
    }
    if (seg !== sp[i]) return null;
  }
  return pp.length === sp.length ? params : null;
}

/** Does "path" sit under "base"? Used for mounted routers. */
function startsWithBase(path, base) {
  if (!base || base === '/') return true;
  var bp = segments(base), sp = segments(path);
  if (sp.length < bp.length) return false;
  for (var i = 0; i < bp.length; i++) if (bp[i] !== sp[i]) return false;
  return true;
}

/** Strip a mount base off a path, always leaving a leading slash. */
function stripBase(path, base) {
  if (!base || base === '/') return path;
  var rest = segments(path).slice(segments(base).length);
  return '/' + rest.join('/');
}

/** Parse a query string the way Express does: repeated keys collapse into an array. */
function parseQuery(url) {
  var q = {}, i = String(url).indexOf('?');
  if (i < 0) return q;
  String(url).slice(i + 1).split('&').forEach(function (pair) {
    if (!pair) return;
    var eq = pair.indexOf('=');
    var k = eq < 0 ? pair : pair.slice(0, eq);
    var v = eq < 0 ? '' : pair.slice(eq + 1);
    try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* keep raw */ }
    if (Object.prototype.hasOwnProperty.call(q, k)) { q[k] = [].concat(q[k], v); } else { q[k] = v; }
  });
  return q;
}

function Layer(method, path, handlers) { this.method = method; this.path = path; this.handlers = handlers; }

function createRouter() {
  var layers = [];
  function add(method, path, handlers) {
    // app.use(fn) — a middleware with no path is mounted at the root for every method.
    if (typeof path === 'function') { handlers = [path].concat(handlers); path = '*'; }
    layers.push(new Layer(method, path, handlers.filter(function (h) { return typeof h === 'function' || (h && h.__nbaiRouter); })));
  }
  var router = {
    __nbaiRouter: true,
    layers: layers,
    use: function (path, fn) {
      var rest = Array.prototype.slice.call(arguments, 1);
      if (typeof path === 'function') { add(null, '*', [path].concat(rest.slice(1))); return router; }
      rest.forEach(function (h) {
        if (h && h.__nbaiRouter) layers.push({ mount: path, router: h });
        else if (typeof h === 'function') layers.push({ mount: path, middleware: h });
      });
      return router;
    },
  };
  ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'].forEach(function (m) {
    router[m] = function (path) {
      add(m === 'all' ? null : m.toUpperCase(), path, Array.prototype.slice.call(arguments, 1));
      return router;
    };
  });
  return router;
}

/**
 * Walk a router's layers for one request. Returns true when a handler ENDED the response.
 *
 * Errors propagate through "next(err)" to the nearest 4-argument middleware, exactly as Express does;
 * a thrown handler is converted to the same thing so a synchronous crash is a 500 with the real
 * message rather than an unhandled rejection nobody sees.
 */
async function runRouter(router, req, res, basePath, errIn) {
  var err = errIn;
  for (var i = 0; i < router.layers.length; i++) {
    if (res.__ended) return true;
    var layer = router.layers[i];

    if (layer.router) {
      if (!startsWithBase(req.path, layer.mount)) continue;
      var saved = req.url, savedPath = req.path;
      req.path = stripBase(savedPath, layer.mount);
      var done = await runRouter(layer.router, req, res, basePath, err);
      req.path = savedPath; req.url = saved;
      if (done || res.__ended) return true;
      continue;
    }

    if (layer.middleware) {
      if (!startsWithBase(req.path, layer.mount)) continue;
      if (err) continue;                                    // plain middleware is skipped while erroring
      err = await invoke(layer.middleware, req, res, err);
      continue;
    }

    if (layer.method && layer.method !== req.method) continue;
    var params = matchPath(layer.path, req.path);
    if (params === null) continue;
    for (var h = 0; h < layer.handlers.length; h++) {
      var fn = layer.handlers[h];
      var isErrorMw = fn.length >= 4;
      if (err && !isErrorMw) continue;
      if (!err && isErrorMw) continue;
      req.params = params;
      var next = await invoke(fn, req, res, err);
      if (res.__ended) return true;
      if (next === undefined) return true;                  // handler neither ended nor called next()
      err = next === true ? null : next;                    // true = plain next(), otherwise an error
    }
  }
  if (err) throw err;                                       // no error middleware claimed it
  return res.__ended === true;
}

/** Call one handler, resolving its "next(...)". Returns true (next called), an error, or undefined. */
function invoke(fn, req, res, err) {
  return new Promise(function (resolve) {
    var settled = false;
    var next = function (e) { if (!settled) { settled = true; resolve(e ? e : true); } };
    var finish = function () { if (!settled) { settled = true; resolve(undefined); } };
    res.__onEnd = finish;
    try {
      var out = fn.length >= 4 ? fn(err, req, res, next) : fn(req, res, next);
      if (out && typeof out.then === 'function') {
        out.then(function () { if (!settled && res.__ended) finish(); }, function (e) { if (!settled) { settled = true; resolve(e || new Error('handler rejected')); } });
      }
    } catch (e) {
      if (!settled) { settled = true; resolve(e || new Error('handler threw')); }
    }
  });
}

function createResponse(resolve) {
  var res = {
    __ended: false, __status: 200, __headers: {}, __onEnd: null,
    status: function (c) { res.__status = c; return res; },
    set: function (k, v) { if (k && typeof k === 'object') { Object.keys(k).forEach(function (n) { res.__headers[String(n).toLowerCase()] = k[n]; }); } else { res.__headers[String(k).toLowerCase()] = v; } return res; },
    header: function (k, v) { return res.set(k, v); },
    type: function (t) { return res.set('content-type', t); },
    json: function (b) { res.set('content-type', 'application/json'); return finish(JSON.stringify(b)); },
    send: function (b) {
      if (b && typeof b === 'object' && !(b instanceof Uint8Array)) return res.json(b);
      if (!res.__headers['content-type']) res.set('content-type', 'text/html; charset=utf-8');
      return finish(b == null ? '' : String(b));
    },
    sendStatus: function (c) { res.__status = c; return finish(String(c)); },
    redirect: function (a, b) {
      var code = typeof a === 'number' ? a : 302, loc = typeof a === 'number' ? b : a;
      res.__status = code; res.set('location', loc); return finish('');
    },
    end: function (b) { return finish(b == null ? '' : String(b)); },
  };
  function finish(body) {
    if (res.__ended) return res;
    res.__ended = true; res.__body = body;
    if (res.__onEnd) res.__onEnd();
    resolve({ status: res.__status, headers: res.__headers, body: body });
    return res;
  }
  return res;
}

function createApp() {
  var router = createRouter();
  var app = {
    __nbaiApp: true, __nbaiRouter: true, layers: router.layers,
    use: router.use, settings: {},
    set: function (k, v) { app.settings[k] = v; return app; },
    get: function (k) {
      // Express's overload: one string argument is settings.get, anything else is a route.
      if (arguments.length === 1 && typeof k === 'string') return app.settings[k];
      return router.get.apply(router, arguments);
    },
    listen: function () {
      // No socket to bind in a browser. The callback still fires because a generated server ends with
      // it and often logs from there; returning a server object keeps "server.close()" from throwing.
      var cb = Array.prototype.slice.call(arguments).filter(function (a) { return typeof a === 'function'; })[0];
      if (cb) { try { cb(); } catch (e) { /* the app's own log line must not break the boot */ } }
      return { close: function (c) { if (typeof c === 'function') c(); }, address: function () { return { port: 0, address: '127.0.0.1' }; } };
    },
    /** Dispatch ONE request through this app. Used by the fetch bridge. */
    __nbaiHandle: function (method, url, headers, rawBody) {
      return new Promise(function (resolve) {
        var res = createResponse(resolve);
        var req = {
          method: String(method || 'GET').toUpperCase(),
          url: url, originalUrl: url, path: String(url).split('?')[0],
          query: parseQuery(url), params: {}, headers: headers || {}, body: undefined,
          __rawBody: rawBody,
          get: function (h) { return (headers || {})[String(h).toLowerCase()]; },
        };
        runRouter(app, req, res, '/', null).then(function (handled) {
          if (res.__ended) return;
          if (!handled) resolve({ status: 404, headers: { 'content-type': 'text/plain' }, body: 'Cannot ' + req.method + ' ' + req.path });
        }, function (err) {
          // Express's default error handler: a 500 carrying the real message, not a swallowed blank.
          resolve({ status: (err && err.status) || 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: (err && err.message) || 'Internal Server Error' }) });
        });
      });
    },
  };
  ['post', 'put', 'patch', 'delete', 'head', 'options', 'all'].forEach(function (m) { app[m] = router[m]; });
  return app;
}

/**
 * The most recently created app.
 *
 * The bridge needs the app INSTANCE, and a generated server almost never exports one — it does
 * "const app = express(); ... app.listen(3000)" and exports nothing at all. Reaching for a
 * module.exports that is not there would make the common shape the unsupported one. Recording it at
 * creation works for every shape, exported or not.
 */
function express() { var app = createApp(); express.__nbaiLastApp = app; return app; }
express.__nbaiLastApp = null;
express.Router = createRouter;
express.json = function () {
  return function (req, res, next) {
    var raw = req.__rawBody;
    if (raw == null || raw === '') { req.body = {}; return next(); }
    var ct = String((req.headers || {})['content-type'] || '');
    if (ct && ct.indexOf('json') < 0) return next();
    // A malformed body is a REAL 400, the way express.json() behaves — not a silent empty object,
    // which would let a broken client look like a working one.
    try { req.body = JSON.parse(raw); next(); }
    catch (e) { var err = new Error('Unexpected token in JSON'); err.status = 400; next(err); }
  };
};
express.urlencoded = function () {
  return function (req, res, next) {
    var raw = req.__rawBody;
    req.body = raw ? parseQuery('?' + raw) : {};
    next();
  };
};
express.text = function () { return function (req, res, next) { req.body = req.__rawBody == null ? '' : String(req.__rawBody); next(); }; };
express.raw = function () { return function (req, res, next) { req.body = req.__rawBody; next(); }; };
// express.static serves files from disk. There is no disk here, so it is a pass-through: the preview
// already serves the app's own assets. Returning a no-op middleware is honest (nothing is claimed to
// be served); inventing file contents would not be.
express.static = function () { return function (req, res, next) { next(); }; };

module.exports = express;
module.exports.default = express;
module.exports.__esModule = true;
`;

/**
 * The bridge: point the app's own "fetch" at the Express shim instead of the network.
 *
 * Mounted as a module so it runs through the same loader; it imports nothing, and it is only injected
 * when proveBackendRunnable has already said yes.
 *
 * ONLY same-origin API paths are intercepted. An absolute URL to a third-party host (a real Supabase
 * project, an image CDN) must keep going to the network — quietly swallowing those would turn a
 * working integration into a mystery.
 */
export const BACKEND_BRIDGE_SOURCE = String.raw`
'use strict';
var app = null;
var pending = [];

/** Point the bridge at the app instance the server module created. */
function register(a) {
  app = a;
  var q = pending; pending = [];
  q.forEach(function (fn) { fn(); });
}

function isApiPath(url) {
  var u = String(url || '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return false;   // absolute URL → a real host, leave it alone
  if (u.charAt(0) !== '/') return false;              // relative-to-document → not our API surface
  return true;
}

var realFetch = typeof fetch === 'function' ? fetch.bind(null) : null;

function install() {
  if (typeof window === 'undefined') return;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var opts = init || {};
    var method = (opts.method || (input && input.method) || 'GET').toUpperCase();
    if (!app || !isApiPath(url)) {
      if (realFetch) return realFetch(input, init);
      return Promise.reject(new Error('fetch is unavailable in this preview'));
    }
    var headers = {};
    var h = opts.headers || (input && input.headers);
    if (h) {
      if (typeof h.forEach === 'function') h.forEach(function (v, k) { headers[String(k).toLowerCase()] = v; });
      else Object.keys(h).forEach(function (k) { headers[String(k).toLowerCase()] = h[k]; });
    }
    var body = opts.body;
    if (body != null && typeof body !== 'string') { try { body = String(body); } catch (e) { body = ''; } }
    return app.__nbaiHandle(method, url, headers, body).then(function (r) {
      return new Response(r.body, { status: r.status, headers: r.headers });
    });
  };
}

install();
module.exports = { register: register, install: install };
module.exports.__esModule = true;
`;
