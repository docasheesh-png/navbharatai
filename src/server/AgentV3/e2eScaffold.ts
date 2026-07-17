// Cap-2 (Tier 2D) — E2E (Playwright) scaffolding. The unit-test scaffold (planAutoTests) already runs
// by default; this adds the OTHER half of Cap-2: a real end-to-end test setup that drives the running app
// in a browser. It generates a minimal `playwright.config.ts` (starts the dev server, sets a baseURL) plus
// a smoke spec that loads the app, asserts it actually renders, and fails on a console/page error or a
// build-error overlay — the same "render, not compile" signal the runtime gate uses, but as a test the user
// owns and can extend. Optional per-route navigation smoke tests when routes are known.
//
// PURE + deterministic + idempotent (the caller writes each file only when absent), mirroring
// appDefaults.ts / TestGenerationAgent.ts. No sandbox/LLM — a real, honest starter the user fills in.

export interface E2eScaffoldInput {
  appName?: string | null;
  /** The dev command to start the app (default `npm run dev`). */
  devCommand?: string | null;
  /** The port the dev server listens on (default 5173 — Vite). */
  port?: number | null;
  /** Known client routes ('/', '/about', …) → one nav smoke test each (bounded). */
  routes?: string[] | null;
}

export interface E2eScaffoldResult {
  /** New files to write (config + specs), keyed by workspace path. */
  files: Record<string, string>;
  /** devDependencies the project must add for these to run. */
  devDependencies: string[];
  /** package.json scripts to add. */
  scripts: Record<string, string>;
  /** Human-readable list of what was scaffolded. */
  added: string[];
}

const CONFIG_PATH = 'playwright.config.ts';
const SMOKE_PATH = 'e2e/smoke.spec.ts';

/** Sanitize a route into a safe, unique test title fragment. */
function routeLabel(route: string): string {
  const r = String(route || '/').trim();
  return r === '/' ? 'home' : r.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9/_-]/g, '-') || 'home';
}

/** Keep only safe, same-origin path routes ('/x'), de-duped and bounded. */
function safeRoutes(routes: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(routes) ? routes : []) {
    if (typeof r !== 'string') continue;
    const p = r.split('?')[0].split('#')[0].trim();
    if (!p.startsWith('/') || p.startsWith('//') || p.includes('..') || p.includes(':')) continue; // static paths only
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 10) break;
  }
  return out;
}

function configTs(devCommand: string, port: number): string {
  return `import { defineConfig, devices } from '@playwright/test';

// Auto-generated Playwright E2E config (NavBharatAI). Starts your dev server, then runs the specs in ./e2e
// against it. Set E2E_BASE_URL to test a deployed URL instead of the local dev server.
const PORT = ${port};
const baseURL = process.env.E2E_BASE_URL || \`http://localhost:\${PORT}\`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Only start a local server when not pointing at a deployed URL.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: '${devCommand}', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
`;
}

function smokeSpec(appName: string, routes: string[]): string {
  const perRoute = routes
    .map(
      (r) => `
  test('${routeLabel(r)} route renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('${r}');
    // The app shell must be visible (not a blank page).
    await expect(page.locator('body')).toBeVisible();
    // No dev-server / bundler error overlay crashed the screen.
    await expect(page.locator('vite-error-overlay, #nextjs-portal, .react-error-overlay')).toHaveCount(0);
    // No runtime console/page errors fired while loading.
    expect(errors, errors.join('\\n')).toEqual([]);
  });`,
    )
    .join('\n');

  return `import { test, expect } from '@playwright/test';

// Auto-generated smoke E2E for ${appName}. It EARNS the "it works" claim by loading the running app in a
// real browser and asserting it renders with no console/page errors — the same render-not-compile bar the
// build uses. Extend these with real user-flow assertions (click, type, expect visible text).
test.describe('${appName} — smoke', () => {
  test('app loads and renders', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    // The page has real, visible content (not an empty mount).
    const text = (await page.locator('body').innerText()).trim();
    expect(text.length, 'the page rendered no visible text').toBeGreaterThan(0);
    await expect(page.locator('vite-error-overlay, #nextjs-portal, .react-error-overlay')).toHaveCount(0);
    expect(errors, errors.join('\\n')).toEqual([]);
  });
${perRoute}
});
`;
}

/**
 * Plan the E2E (Playwright) scaffold. Pure + deterministic. Returns the config + smoke spec files, the
 * devDependencies and scripts the project needs, and a summary of what was added.
 */
export function planE2eScaffold(input: E2eScaffoldInput = {}): E2eScaffoldResult {
  const appName = (input.appName && String(input.appName).trim()) || 'App';
  const devCommand = (input.devCommand && String(input.devCommand).trim()) || 'npm run dev';
  const port = typeof input.port === 'number' && input.port > 0 && input.port < 65536 ? Math.floor(input.port) : 5173;
  const routes = safeRoutes(input.routes).filter((r) => r !== '/'); // '/' is already the base smoke test

  const files: Record<string, string> = {
    [CONFIG_PATH]: configTs(devCommand, port),
    [SMOKE_PATH]: smokeSpec(appName, routes),
  };
  return {
    files,
    devDependencies: ['@playwright/test'],
    scripts: { 'test:e2e': 'playwright test', 'test:e2e:ui': 'playwright test --ui' },
    added: [CONFIG_PATH, SMOKE_PATH],
  };
}

/** A short human summary of an E2E scaffold result, for narration/tool output. Pure. */
export function e2eScaffoldSummary(result: E2eScaffoldResult): string {
  return [
    `Scaffolded Playwright E2E: ${result.added.join(', ')}.`,
    `Add the dev dep: ${result.devDependencies.join(', ')} (run \`npm i -D @playwright/test && npx playwright install chromium\`).`,
    `Scripts: ${Object.entries(result.scripts).map(([k, v]) => `"${k}": "${v}"`).join(', ')}.`,
    `Run with \`npm run test:e2e\` — it loads the running app and fails on a blank screen, an error overlay, or a console/page error.`,
  ].join('\n');
}
