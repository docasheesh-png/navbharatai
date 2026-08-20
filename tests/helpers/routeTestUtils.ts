/**
 * Lightweight Express route test harness — no supertest, no real HTTP.
 *
 * `captureRoutes(register)` calls a `registerXRoutes(app, ...)` function with a
 * fake Express app that records every handler keyed by "METHOD path". Tests then
 * invoke a handler directly with mock req/res and assert on the captured response.
 *
 * This exercises the REAL route logic (validation, status codes, payload shape)
 * without booting a server or adding dependencies.
 */

type Handler = (req: any, res: any) => any;

export interface CapturedApp {
  routes: Map<string, Handler>;
  get(path: string, ...h: Handler[]): void;
  post(path: string, ...h: Handler[]): void;
  put(path: string, ...h: Handler[]): void;
  delete(path: string, ...h: Handler[]): void;
  all(path: string, ...h: Handler[]): void;
  options(path: string, ...h: Handler[]): void;
  use(...args: any[]): void;
}

/** Build a fake Express app and run the registration fn against it. */
export function captureRoutes(register: (app: any, ...rest: any[]) => void, ...rest: any[]): Map<string, Handler> {
  const routes = new Map<string, Handler>();
  const record = (method: string) => (path: string, ...handlers: Handler[]) => {
    // The last handler is the actual route handler (earlier ones are middleware).
    routes.set(`${method} ${path}`, handlers[handlers.length - 1]);
  };
  const app: CapturedApp = {
    routes,
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    delete: record('DELETE'),
    all: record('ALL'),
    // OPTIONS exists because real routes register CORS preflights (the store's shared-data API — its
    // caller is an opaque-origin iframe whose JSON POSTs always preflight). A fake app that lacks a
    // verb the real express has makes route REGISTRATION crash in tests while production is fine —
    // which is how this line was added: `app.options` took down the whole navStoreRoutes suite.
    options: record('OPTIONS'),
    use: () => { /* middleware ignored in unit tests */ },
  };
  register(app, ...rest);
  return routes;
}

export interface MockResponse {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  ended: boolean;
  sent: any;
  status(code: number): MockResponse;
  json(payload: any): MockResponse;
  send(payload: any): MockResponse;
  /** Express's content-type shortcut. Modelled because real routes use it (a download that fails must
   *  answer a BROWSER in HTML, not JSON) — a mock missing it fails a route that is perfectly correct. */
  type(t: string): MockResponse;
  end(): MockResponse;
  /** Abrupt close, used when a stream fails after the headers have already gone out. */
  destroy(): MockResponse;
  headersSent?: boolean;
  setHeader(k: string, v: string): void;
  header(k: string, v: string): MockResponse;
  get(k: string): string | undefined;
}

/** Create a mock Express Response that records status/body/headers. */
export function mockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    headers: {},
    ended: false,
    sent: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
    send(payload: any) { this.sent = payload; this.body = payload; this.headersSent = true; return this; },
    type(t: string) { this.headers['content-type'] = t.includes('/') ? t : `text/${t}`; return this; },
    end() { this.ended = true; return this; },
    destroy() { this.ended = true; return this; },
    headersSent: false,
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; },
    header(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this; },
    get(k: string) { return this.headers[k.toLowerCase()]; },
  };
  return res;
}

/** Create a mock Express Request. */
export function mockReq(opts: Partial<{ body: any; query: any; params: any; headers: any; protocol: string }> = {}): any {
  return {
    body: opts.body ?? {},
    query: opts.query ?? {},
    params: opts.params ?? {},
    headers: opts.headers ?? {},
    protocol: opts.protocol ?? 'https',
    socket: { remoteAddress: '127.0.0.1' },
    get(key: string) { return (this.headers as any)[key.toLowerCase()]; },
  };
}
