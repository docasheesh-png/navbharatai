import { describe, it, expect } from 'vitest';
import { extractEndpoints, extractApiCalls, buildApiGraph } from './apiGraph';

// GA-5: API-endpoint graph. Pure — extract backend routes + frontend calls and diff them.

describe('extractEndpoints', () => {
  it('extracts Express routes with method + normalized path', () => {
    const eps = extractEndpoints([
      { path: 'server.ts', content: "app.get('/api/users', h);\nrouter.post('/api/users/:id', h);\n" },
    ]);
    expect(eps).toContainEqual({ method: 'GET', path: '/api/users', file: 'server.ts' });
    expect(eps).toContainEqual({ method: 'POST', path: '/api/users/:p', file: 'server.ts' });
  });

  it('extracts FastAPI/Flask decorators and Spring mappings', () => {
    const eps = extractEndpoints([
      { path: 'main.py', content: '@app.get("/items")\n@app.route("/legacy", methods=["POST"])\n' },
      { path: 'Ctrl.java', content: '@GetMapping("/health")\n@PostMapping(value = "/orders")\n' },
    ]);
    expect(eps).toContainEqual({ method: 'GET', path: '/items', file: 'main.py' });
    expect(eps).toContainEqual({ method: 'POST', path: '/legacy', file: 'main.py' });
    expect(eps).toContainEqual({ method: 'GET', path: '/health', file: 'Ctrl.java' });
    expect(eps).toContainEqual({ method: 'POST', path: '/orders', file: 'Ctrl.java' });
  });
});

describe('extractApiCalls', () => {
  it('extracts axios + fetch calls (with method) to same-origin paths only', () => {
    const calls = extractApiCalls([
      { path: 'api.ts', content: "axios.get('/api/users');\nfetch('/api/users', { method: 'POST' });\nfetch('https://cdn.x/y');\naxios.get('//cdn/z');\n" },
    ]);
    expect(calls).toContainEqual({ method: 'GET', path: '/api/users', file: 'api.ts' });
    expect(calls).toContainEqual({ method: 'POST', path: '/api/users', file: 'api.ts' });
    // external + protocol-relative URLs are ignored
    expect(calls.every(c => !c.path.includes('cdn'))).toBe(true);
  });

  it('defaults fetch without options to GET and reads axios({url,method})', () => {
    const calls = extractApiCalls([
      { path: 'a.ts', content: "fetch('/health');\naxios({ url: '/orders', method: 'post' });\n" },
    ]);
    expect(calls).toContainEqual({ method: 'GET', path: '/health', file: 'a.ts' });
    expect(calls).toContainEqual({ method: 'POST', path: '/orders', file: 'a.ts' });
  });
});

describe('buildApiGraph', () => {
  it('flags a frontend call with no matching backend route as missing', () => {
    const g = buildApiGraph([
      { path: 'server.ts', content: "app.get('/api/users', h);\n" },
      { path: 'client.ts', content: "axios.get('/api/users');\naxios.post('/api/orders', body);\n" },
    ]);
    expect(g.missing.map(m => m.path)).toContain('/api/orders'); // no backend route
    expect(g.missing.map(m => m.path)).not.toContain('/api/users'); // matched
  });

  it('matches a concrete call path against a param route (/users/:id)', () => {
    const g = buildApiGraph([
      { path: 's.ts', content: "router.get('/api/users/:id', h);\n" },
      { path: 'c.ts', content: "axios.get('/api/users/42');\n" },
    ]);
    expect(g.missing).toEqual([]);
  });

  it('reports unused endpoints (defined, never called)', () => {
    const g = buildApiGraph([
      { path: 's.ts', content: "app.get('/api/a', h);\napp.get('/api/unused', h);\n" },
      { path: 'c.ts', content: "fetch('/api/a');\n" },
    ]);
    expect(g.unused.map(e => e.path)).toContain('/api/unused');
    expect(g.unused.map(e => e.path)).not.toContain('/api/a');
  });

  it('does NOT flag missing when the repo defines no endpoints (external backend — avoid false positives)', () => {
    const g = buildApiGraph([{ path: 'c.ts', content: "axios.get('/api/x');\n" }]);
    expect(g.missing).toEqual([]);
    expect(g.called.length).toBe(1);
  });
});
