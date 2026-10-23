/**
 * Q-162: of the server's `/api` routes, dozens had nothing in the app that called them. Two of them were a
 * feature that looked done and did nothing:
 *   • the gallery's review queue — every submission is created `pending`, the admin review route is the ONLY
 *     path to `approved`, and no screen called it, so "Send for review" promised a review nobody could do;
 *   • closing a version preview — the stop route was written "for when the user dismisses the preview" and
 *     never called, so the old version's server kept its port until something displaced it.
 * The class: a server action whose client half was never wired. The census below makes it visible the day
 * it happens — a new route with no caller fails CI until it gets one, or is listed with the reason nothing
 * in the app calls it — and the baseline may only shrink.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { uncalledRoutes, isCalled, stripComments, serverApiRoutes, expandBaseConstants } from './apiRouteCallers';
import { galleryReviewApi } from '../src/components/panels/GalleryReviewQueue';
import { stopVersionPreview } from '../src/lib/versionPreviewStop';

const BASELINE: Record<string, string> = JSON.parse(readFileSync('tests/fixtures/uncalledApiRoutesBaseline.json', 'utf8'));
const KINDS = ['external', 'injected', 'legacy-bundled', 'admin-url', 'undecided'];

describe('🔒 a caller that builds its path from a base is still a caller (Q-818)', () => {
  it('`${API_BASE}/x`, `${this.BASE}/x` and `${Svc.BASE}/x` are read as the path they build', () => {
    const src = "const API_BASE = '/api/foo';\nfetch(`${API_BASE}/bar`);\nclass S { static BASE = '/api/svc/'; go() { return fetch(`${this.BASE}/x`) } }\nfetch(`${S.BASE}/y?z=1`);";
    const client = expandBaseConstants(src);
    expect(isCalled('/api/foo/bar', client)).toBe(true);
    expect(isCalled('/api/svc/x', client)).toBe(true);
    expect(isCalled('/api/svc/y', client)).toBe(true);
    // without the expansion the census was blind to all three
    expect(isCalled('/api/foo/bar', src)).toBe(false);
  });

  it('recognizes the supported versioned alias without inventing callers for unknown versions', () => {
    expect(isCalled('/api/failedbr/reports', "fetch('/api/v1/failedbr/reports')")).toBe(true);
    expect(isCalled('/api/failedbr/reports/:workspaceId/:historyId', "fetch(`/api/v1/failedbr/reports/${workspaceId}/${historyId}`)")).toBe(true);
    expect(isCalled('/api/failedbr/reports', "fetch('/api/v2/failedbr/reports')")).toBe(false);
    expect(isCalled('/api/v1/data/:workspaceId/:collection', "fetch(`/api/v1/data/${workspaceId}/${collection}`)")).toBe(true);
  });

  it('a name never borrows another file\'s base, and a dynamic value is left alone', () => {
    expect(expandBaseConstants('fetch(`${API_BASE}/bar`)')).toBe('fetch(`${API_BASE}/bar`)');
    expect(expandBaseConstants("const B = `/api/${v}`; fetch(`${B}/x`)")).toContain('${B}/x');
  });
});

describe('census: every /api route has a caller, or a written reason it has none', () => {
  const now = uncalledRoutes();

  it('the reviewed gateway setup UI really calls status, preview and review', () => {
    const client = stripComments(readFileSync('src/components/admin/InferenceGatewaySetupPanel.tsx', 'utf8'));
    for (const path of ['/api/admin/inference-gateway/setup', '/api/admin/inference-gateway/setup/preview', '/api/admin/inference-gateway/setup/review']) {
      expect(isCalled(path, client), path).toBe(true);
    }
    for (const action of ['status', 'preview', 'review']) expect(client).toContain(`run(ENDPOINTS.${action}`);
  });

  it('no NEW route without a caller', () => {
    const fresh = now.filter((r) => !(r in BASELINE));
    expect(fresh, 'Wire a caller, or add the route to tests/fixtures/uncalledApiRoutesBaseline.json with who calls it').toEqual([]);
  });

  it('the baseline only shrinks — a route that gained a caller (or was deleted) leaves it', () => {
    const stale = Object.keys(BASELINE).filter((r) => !now.includes(r));
    expect(stale, 'Remove these from tests/fixtures/uncalledApiRoutesBaseline.json').toEqual([]);
  });

  it('the undecided ones are listed per file, so a session touching that file sees what to decide (CLAUDE.md, Q-162)', () => {
    // Not a failure: the rule is "decide it when you touch its file". This keeps the list readable by file.
    const routes = serverApiRoutes();
    const byFile: Record<string, string[]> = {};
    for (const [r, why] of Object.entries(BASELINE)) {
      if (!why.startsWith('undecided')) continue;
      const [method, path] = r.split(' ');
      const f = routes.find((x) => x.method === method && x.path === path)?.file ?? '(not found)';
      (byFile[f] ??= []).push(r);
    }
    expect(Object.keys(byFile)).not.toContain('(not found)');
  });

  it('every entry says what kind of reason it is', () => {
    for (const [r, why] of Object.entries(BASELINE)) expect(KINDS, r).toContain(why.split(':')[0]);
  });

  it('the matcher: a parameter route is called by its literal prefix, a comment is never a caller', () => {
    expect(isCalled('/api/gallery/admin/:id/review', "fetch(`/api/gallery/admin/${id}/review`)")).toBe(true);
    expect(isCalled('/api/live', "fetch('/api/live')")).toBe(true);
    expect(isCalled('/api/live', "fetch('/api/lively')")).toBe(false);
    expect(isCalled('/api/live', stripComments("// fetch('/api/live')\nconst x = 1;"))).toBe(false);
    expect(stripComments("const u = 'https://x.dev/a'; // note")).toBe("const u = 'https://x.dev/a'; ");
  });

  it('official provider metadata links do not invent a local developer API caller', () => {
    expect(now).toContain('GET /api/models');
    expect(BASELINE['GET /api/models']).toMatch(/^external:/);
  });

  it('the registry read and both mutations have explicit real UI callers', () => {
    const panel = expandBaseConstants(stripComments(readFileSync('src/components/admin/LiveModelRegistryPanel.tsx', 'utf8')));
    for (const path of ['/api/admin/live-model-registry', '/api/admin/live-model-registry/sync', '/api/admin/live-model-registry/models/action']) {
      expect(isCalled(path, panel), path).toBe(true);
    }
    expect(now).not.toContain('POST /api/admin/live-model-registry/sync');
    expect(now).not.toContain('POST /api/admin/live-model-registry/models/action');
  });

  it('Free Chat Chain status and controls have real versioned UI callers', () => {
    const panel = expandBaseConstants(stripComments(readFileSync('src/components/admin/FreeChatChainPanel.tsx', 'utf8')));
    for (const path of ['/api/admin/free-chat-chain', '/api/admin/free-chat-chain/control', '/api/admin/free-chat-chain/budget', '/api/admin/free-chat-chain/metrics']) expect(isCalled(path, panel), path).toBe(true);
    expect(now).not.toContain('GET /api/admin/free-chat-chain');
    expect(now).not.toContain('POST /api/admin/free-chat-chain/control');
    expect(now).not.toContain('POST /api/admin/free-chat-chain/budget');
    expect(now).not.toContain('GET /api/admin/free-chat-chain/metrics');
  });

  it('the two dead client halves are wired', () => {
    for (const r of ['GET /api/gallery/admin/:id/source', 'POST /api/gallery/admin/:id/review', 'GET /api/gallery/admin/pending', 'POST /api/agentv3/version-preview/stop']) {
      expect(now, r).not.toContain(r);
      expect(BASELINE, r).not.toHaveProperty(r);
    }
    const panel = readFileSync('src/components/panels/GalleryPanel.tsx', 'utf8');
    expect(panel).toContain('<GalleryReviewQueue');
    const v3 = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    expect(v3).toMatch(/onExitVersion=\{\(\) => \{ void stopVersionPreview\(/);
  });
});

describe('the gallery review queue', () => {
  afterEach(() => vi.unstubAllGlobals());
  const headers = async () => ({ 'Content-Type': 'application/json' });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('is nothing at all for someone the server does not call a reviewer', async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', vi.fn(async () => json(status, { error: 'Not allowed.' })));
      expect(await galleryReviewApi(headers).listPending()).toBeNull();
    }
  });

  it('lists, reads the code, and decides through the real admin routes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/gallery/admin/pending') return json(200, { apps: [{ id: 'a b', title: 'Shop', description: '', authorName: 'x', fileCount: 2, files: ['a.ts'] }] });
      if (url.endsWith('/source')) return json(200, { id: 'a b', files: { 'a.ts': 'export {}' } });
      return json(200, { ok: true, id: 'a b', status: JSON.parse(String(init?.body)).decision });
    }));
    const api = galleryReviewApi(headers);
    expect((await api.listPending())?.[0].title).toBe('Shop');
    expect(await api.readSource('a b')).toEqual({ 'a.ts': 'export {}' });
    await api.review('a b', 'approved', 'Looks good');
    expect(calls[1].url).toBe('/api/gallery/admin/a%20b/source');
    expect(calls[2].url).toBe('/api/gallery/admin/a%20b/review');
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ decision: 'approved', note: 'Looks good', reasonContract: 1 });
  });

  it('a decision the server did not confirm is an error, never a silent success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { error: 'Could not save that decision. Please try again.' })));
    await expect(galleryReviewApi(headers).review('x', 'rejected', '')).rejects.toThrow('Could not save that decision');
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { ok: true, status: 'approved' })));
    await expect(galleryReviewApi(headers).review('x', 'removed', '')).rejects.toThrow('did not confirm');
  });

  it('Approve exists only beside code that was opened', () => {
    const src = readFileSync('src/components/panels/GalleryReviewQueue.tsx', 'utf8');
    const approve = src.indexOf("decide(a.id, 'approved')");
    expect(approve).toBeGreaterThan(src.indexOf('{open === a.id && ('));
  });
});

describe('closing a version preview stops it on the server', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the workspace and sha, and never throws', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => { seen.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, stopped: true }), { status: 200 }); }));
    expect(await stopVersionPreview({ workspaceId: 'w1', sha: 'abc1234', userId: 'u', email: 'e' })).toBe(true);
    expect(seen[0]).toEqual({ workspaceId: 'w1', sha: 'abc1234', userId: 'u', email: 'e' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await stopVersionPreview({ workspaceId: 'w1', sha: 'abc1234' })).toBe(false);
    expect(await stopVersionPreview({ workspaceId: '', sha: 'abc1234' })).toBe(false);
  });
});
