import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Website → App (ROADMAP §13, 4.2): the wiring, locked against the real source. */
const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const route = src('src/server/routes/siteImport.ts');
const server = src('server.ts');
const client = src('src/components/ide/ScreenshotToCode.tsx');
const akb = src('src/server/AppContext/AppKnowledgeBase.ts');

describe('🔒 the site-import route', () => {
  it('is registered in server.ts', () => {
    expect(server).toContain("import { registerSiteImportRoutes } from './src/server/routes/siteImport';");
    expect(server).toContain('registerSiteImportRoutes(app);');
    expect(route).toContain("app.post('/api/site-import/to-prompt'");
  });

  it('fetches ONLY through the SSRF-guarded reader — never a raw fetch, never a second fetcher', () => {
    expect(route).toContain('await webFetchUrl(url, { keepHtml: true })');
    expect(route).not.toMatch(/\bfetch\(/);
    expect(route).not.toMatch(/\bhttps?\.(get|request)\(/);
    expect(route).not.toContain('axios');
  });

  it('requires a signed-in account and gives anonymous callers no allowance at all', () => {
    expect(route).toContain("await requireAccountForCostlyAi(req, 'Website → App')");
    expect(route).toMatch(/anon:\s*0/);
    expect(route).toMatch(/anonGlobalPerHour:\s*0/);
  });

  it('🔒 makes NO model call and therefore charges nothing — a deterministic tool is free by the one-wallet law', () => {
    for (const forbidden of ['runVisionChain', 'inAiSpendZone', 'gateToolAction', 'burnToolAction', 'chargeToolAction', 'ClaudeClient', 'routeModel']) {
      expect(route, forbidden).not.toContain(forbidden);
    }
  });

  it('hard-appends the design & anti-phishing policy server-side, after the spec', () => {
    expect(route).toContain("import { cloneGuardrailsBlock } from './screenshotToPrompt';");
    expect(route).toMatch(/buildSiteImportPrompt\([\s\S]*\)\}\\n\\n\$\{cloneGuardrailsBlock\(\)\}`/);
  });

  it('an unreadable or refused address is an honest 422 in the guard\'s own words, never an invented spec', () => {
    expect(route).toContain('if (!fetched.ok && !fetched.html) {');
    expect(route).toContain("res.status(422).json({ error: fetched.reason ?? 'Could not read that website.' })");
    expect(route).toContain('That address is not a web page');
  });
});

describe('🔒 the client', () => {
  it('posts the address to the real route and hands the spec to the real engine', () => {
    expect(client).toContain("fetch('/api/site-import/to-prompt'");
    const start = client.indexOf('const handleImportUrl');
    const block = client.slice(start, start + 2500);
    expect(start).toBeGreaterThan(-1);
    // Honest failure: the server's sentence is shown; no canned result.
    expect(block).toContain('data.error');
    // Build is a SECOND, explicit press — after the user has seen what was read.
    const build = client.indexOf('const handleBuildFromSite');
    expect(build).toBeGreaterThan(start);
    expect(client.slice(build, build + 800)).toContain('onBuildViaV5(sitePrompt)');
  });

  it('shows the user what was read (the extracted structure) before Build, and the copyright note', () => {
    expect(client).toContain('extracted.nav');
    expect(client).toContain('extracted.colors');
    expect(client).toMatch(/draws itself with JavaScript/);
    expect(client).toMatch(/images, logos/);
  });
});

describe('the knowledge base knows the feature', () => {
  it('has an entry the AIs can navigate from', () => {
    expect(akb).toContain("id: 'website_to_app'");
    expect(akb).toContain('From a website address');
  });
});
