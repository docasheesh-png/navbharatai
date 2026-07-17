import { describe, it, expect } from 'vitest';
import { planE2eScaffold, e2eScaffoldSummary } from './e2eScaffold';

describe('planE2eScaffold', () => {
  it('generates a playwright config + a smoke spec with the app name', () => {
    const r = planE2eScaffold({ appName: 'TaskFlow' });
    expect(r.added).toEqual(['playwright.config.ts', 'e2e/smoke.spec.ts']);
    expect(r.files['playwright.config.ts']).toContain("defineConfig");
    expect(r.files['playwright.config.ts']).toContain('webServer');
    expect(r.files['e2e/smoke.spec.ts']).toContain('TaskFlow — smoke');
    expect(r.files['e2e/smoke.spec.ts']).toContain("await page.goto('/')");
    // Renders-not-compiles bar: asserts visible content + no error overlay + no console/page errors.
    expect(r.files['e2e/smoke.spec.ts']).toContain('error-overlay');
    expect(r.files['e2e/smoke.spec.ts']).toContain('pageerror');
    expect(r.devDependencies).toEqual(['@playwright/test']);
    expect(r.scripts['test:e2e']).toBe('playwright test');
  });

  it('uses the given dev command + port in the config', () => {
    const r = planE2eScaffold({ devCommand: 'pnpm dev', port: 3000 });
    expect(r.files['playwright.config.ts']).toContain('const PORT = 3000;');
    expect(r.files['playwright.config.ts']).toContain("command: 'pnpm dev'");
  });

  it('adds a per-route nav test for each known route (excluding the base "/")', () => {
    const r = planE2eScaffold({ routes: ['/', '/about', '/pricing'] });
    const spec = r.files['e2e/smoke.spec.ts'];
    expect(spec).toContain("about route renders without errors");
    expect(spec).toContain("pricing route renders without errors");
    expect(spec).toContain("await page.goto('/about')");
    // '/' is covered by the base "app loads" test, not duplicated as a per-route test.
    expect((spec.match(/route renders without errors/g) || []).length).toBe(2);
  });

  it('drops unsafe / dynamic / duplicate routes (static same-origin paths only)', () => {
    const r = planE2eScaffold({ routes: ['/users/:id', '//evil.com', '/../x', '/ok', '/ok', 'http://x'] });
    const spec = r.files['e2e/smoke.spec.ts'];
    expect((spec.match(/route renders without errors/g) || []).length).toBe(1); // only /ok survives
    expect(spec).toContain("await page.goto('/ok')");
    expect(spec).not.toContain(':id');
  });

  it('falls back to sane defaults', () => {
    const r = planE2eScaffold();
    expect(r.files['playwright.config.ts']).toContain('const PORT = 5173;');
    expect(r.files['e2e/smoke.spec.ts']).toContain('App — smoke');
  });
});

describe('e2eScaffoldSummary', () => {
  it('explains the files, the dep to add, and how to run it', () => {
    const s = e2eScaffoldSummary(planE2eScaffold({ appName: 'X' }));
    expect(s).toContain('playwright.config.ts');
    expect(s).toContain('@playwright/test');
    expect(s).toContain('npm run test:e2e');
  });
});
