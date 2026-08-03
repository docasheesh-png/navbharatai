import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spaFallbackShouldDefer, SERVER_ROUTE_PREFIXES, SERVER_ROUTE_EXACT } from './spaFallback';

describe('spaFallbackShouldDefer — deployed user apps must not be swallowed by the SPA catch-all', () => {
  it('THE REAL FAILURE: a deployed PWA link reaches its own handler, not NavBharatAI', () => {
    // Reported verbatim: user deploys via Settings → Hosting & Deploy → Deploy to NavBharatAI, gets
    // this link, opens it — and sees NavBharatAI instead of their own app.
    expect(spaFallbackShouldDefer('/pwa/3a72ce61782af3c4')).toBe(true);
    expect(spaFallbackShouldDefer('/pwa/3a72ce61782af3c4/manifest.json')).toBe(true);
    expect(spaFallbackShouldDefer('/pwa/3a72ce61782af3c4/sw.js')).toBe(true);
  });

  it('defers every other real server route (the previously hand-added ones stay covered)', () => {
    for (const p of [
      '/api/agentv3/status', '/api/wallet/abc',
      '/preview/sess-1', '/preview-app/sess-1/assets/index.js',
      '/guide', '/guide/', '/status', '/status/',
    ]) {
      expect(spaFallbackShouldDefer(p), p).toBe(true);
    }
  });

  it('still serves the SPA for CLIENT-side routes — deferring one would 404 the app', () => {
    for (const p of ['/', '/admin', '/store', '/?view=appstore', '/sonic', '/anything-react-routes']) {
      expect(spaFallbackShouldDefer(p), p).toBe(false);
    }
  });

  it('does not defer a path that merely CONTAINS a server prefix later in the string', () => {
    expect(spaFallbackShouldDefer('/myapp/pwa/123')).toBe(false);
    expect(spaFallbackShouldDefer('/docs/api/thing')).toBe(false);
  });

  it('tolerates junk input', () => {
    for (const junk of ['', null as never, undefined as never, 123 as never]) {
      expect(() => spaFallbackShouldDefer(junk)).not.toThrow();
      expect(spaFallbackShouldDefer(junk)).toBe(false);
    }
  });
});

describe('the exclusion list cannot silently drift again (the bug class, not just /pwa/)', () => {
  // The inline list was hand-maintained and drifted twice — the preview once, the deployed PWA again.
  // This test reads the REAL route files and fails if a non-/api server GET route exists whose prefix
  // nobody declared here, so the next added route cannot silently return index.html.
  const ROUTE_FILES = [
    'src/server/routes/pwa.ts',
    'src/server/routes/preview.ts',
    'src/server/routes/health.ts',
    'src/server/lib/KnowledgeDocs.ts',
  ];

  it('every non-/api GET path in the real route modules is covered by the list', () => {
    const uncovered: string[] = [];
    for (const file of ROUTE_FILES) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/app\.(?:get|all)\(\s*['"`](\/[^'"`]*)['"`]/g)) {
        const path = m[1];
        if (path.startsWith('/api/')) continue;
        // Replace :params and globs with a concrete segment so the check runs on a realistic URL.
        const concrete = path.replace(/:[A-Za-z0-9_]+/g, 'x').replace(/\*/g, 'x');
        if (!spaFallbackShouldDefer(concrete)) uncovered.push(`${file}: ${path}`);
      }
    }
    expect(uncovered, `these server routes would be swallowed by the SPA fallback:\n${uncovered.join('\n')}`).toEqual([]);
  });

  it('server.ts delegates to this function instead of keeping its own inline list', () => {
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toContain('spaFallbackShouldDefer');
    // The old inline chain must be gone — two sources of truth is exactly how /pwa/ went missing.
    expect(server).not.toMatch(/req\.path\.startsWith\('\/preview-app\/'\)/);
  });

  it('the lists are non-empty and normalized (prefixes end with /, exact paths do not)', () => {
    expect(SERVER_ROUTE_PREFIXES.length).toBeGreaterThan(0);
    for (const p of SERVER_ROUTE_PREFIXES) expect(p.endsWith('/'), p).toBe(true);
    for (const p of SERVER_ROUTE_EXACT) expect(p.endsWith('/'), p).toBe(false);
  });
});
