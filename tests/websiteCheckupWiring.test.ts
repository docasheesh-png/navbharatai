import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Website Checkup (Phase 1): the wiring, locked against the real source — the same discipline as
 * `siteImportWiring.test.ts`. The behaviour lives in `websiteCheckup.test.ts`; this file proves the
 * feature is actually reachable and stays free, own-sites-only and white-label.
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const route = src('src/server/routes/websiteCheckup.ts');
const engine = src('src/server/lib/websiteCheckup.ts');
const server = src('server.ts');
const client = src('src/components/ide/WebsiteCheckup.tsx');
const panels = src('src/components/panels/ViewPanels.tsx');
const groups = src('src/components/home/homeToolGroups.ts');
const akb = src('src/server/AppContext/AppKnowledgeBase.ts');
const types = src('src/types/index.ts');

describe('🔒 Website Checkup route', () => {
  it('is registered in server.ts', () => {
    expect(server).toContain("import { registerWebsiteCheckupRoutes } from './src/server/routes/websiteCheckup';");
    expect(server).toContain('registerWebsiteCheckupRoutes(app);');
    expect(route).toContain("app.post('/api/website-checkup'");
    expect(route).toContain("app.get('/api/website-checkup/sites'");
  });

  it('🔒 enforces OWN-SITES-ONLY through the pure ownership decision, bound to the verified uid', () => {
    // The client never sends a URL; it sends a workspaceId the server binds to the caller.
    expect(route).toContain('decideCheckupAccess(record, identity.uid)');
    expect(route).toContain('await verifyFirebaseIdentity(req)');
    // The URL that gets checked comes from the resolved record, not the request body.
    expect(route).toContain('runCheckup(access.url');
    expect(route).not.toMatch(/runCheckup\(\s*req\.body/);
  });

  it('🔒 fetches ONLY through the shared SSRF guard, re-validated on every redirect hop', () => {
    expect(engine).toContain("import { assertPublicHttpUrl } from './ssrfGuard';");
    expect(engine).toContain('await assertPublicHttpUrl(current)');
    // The guard is inside the redirect loop, so each hop is checked, not just the first URL.
    expect(engine).toMatch(/for \(let hop[\s\S]*assertPublicHttpUrl\(current\)/);
  });

  it('🔒 makes NO model call and charges nothing — a deterministic tool is free by the one-wallet law', () => {
    for (const forbidden of ['inAiSpendZone', 'gateToolAction', 'burnToolAction', 'chargeToolAction', 'ClaudeClient', 'runVisionChain', 'callProfessionalAI']) {
      expect(route, forbidden).not.toContain(forbidden);
      expect(engine, forbidden).not.toContain(forbidden);
    }
  });
});

describe('🔒 Website Checkup is reachable in the UI', () => {
  it('has a ViewType, a tool tile, and a panel branch', () => {
    expect(types).toContain("'debugger' | 'checkup' |");
    expect(groups).toContain("{ id: 'checkup', label: 'Website Checkup', icon: ShieldCheck }");
    expect(panels).toContain("import('../ide/WebsiteCheckup')");
    expect(panels).toContain("activeView === 'checkup'");
    expect(panels).toContain('<WebsiteCheckup />');
  });

  it('is documented in AppKnowledgeBase with a direct-nav target', () => {
    expect(akb).toContain("id: 'website_checkup'");
    expect(akb).toContain("nav: { view: 'checkup' }");
  });

  it('the client sends an auth token and never takes a typed URL', () => {
    expect(client).toContain('await authJsonHeaders()');
    expect(client).toContain("JSON.stringify({ workspaceId: selected })");
    // No free-text URL input — the site comes from the server-provided dropdown only.
    expect(client).not.toMatch(/type=["']url["']/);
    expect(client).not.toMatch(/placeholder=["'][^"']*https?:/i);
  });
});
