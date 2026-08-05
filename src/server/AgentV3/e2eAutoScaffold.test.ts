import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  shouldAutoScaffoldE2e, hasExistingE2e, hasUserInterface, e2eAutoScaffoldNote,
} from './e2eAutoScaffold';

const uiApp = { 'index.html': '<div id=root>', 'src/App.tsx': 'export default () => null;' };
const base = { files: uiApp, ok: true, isImportTurn: false, hasPreview: true };

describe('shouldAutoScaffoldE2e', () => {
  it('writes the net for a working app with a UI', () => {
    expect(shouldAutoScaffoldE2e(base)).toEqual({ scaffold: true, reason: '' });
  });

  it('does not test a build that failed', () => {
    const d = shouldAutoScaffoldE2e({ ...base, ok: false });
    expect(d.scaffold).toBe(false);
    expect(d.reason).toContain('nothing worth testing');
  });

  it('leaves an import/survey turn completely untouched', () => {
    // The user asked us not to change their files, and writing a test suite is changing them.
    const d = shouldAutoScaffoldE2e({ ...base, isImportTurn: true });
    expect(d.scaffold).toBe(false);
    expect(d.reason).toContain('left untouched');
  });

  it('never clobbers an E2E setup the project already has', () => {
    for (const existing of [
      { 'playwright.config.ts': '' },
      { 'cypress.config.js': '' },
      { 'e2e/login.spec.ts': '' },
      { 'tests/e2e/checkout.test.ts': '' },
    ]) {
      const d = shouldAutoScaffoldE2e({ ...base, files: { ...uiApp, ...existing } });
      expect(d.scaffold, JSON.stringify(existing)).toBe(false);
      expect(d.reason).toContain('already has an end-to-end setup');
    }
  });

  it('skips an API-only project — a browser test there could only ever fail', () => {
    // Handing someone a permanently-red suite alongside a working app is the worst outcome here.
    const d = shouldAutoScaffoldE2e({ ...base, files: { 'server/index.js': "const app = express();" } });
    expect(d.scaffold).toBe(false);
    expect(d.reason).toContain('no user interface');
  });

  it('skips when there is no preview to point the tests at', () => {
    expect(shouldAutoScaffoldE2e({ ...base, hasPreview: false }).scaffold).toBe(false);
  });

  it('every refusal carries a reason — a silent skip cannot be told from a broken skip', () => {
    for (const ctx of [
      { ...base, ok: false },
      { ...base, isImportTurn: true },
      { ...base, hasPreview: false },
      { ...base, files: {} },
    ]) {
      const d = shouldAutoScaffoldE2e(ctx);
      expect(d.scaffold).toBe(false);
      expect(d.reason.length).toBeGreaterThan(10);
    }
  });

  it('survives junk input without throwing', () => {
    expect(shouldAutoScaffoldE2e(null as never).scaffold).toBe(false);
    expect(shouldAutoScaffoldE2e({ ...base, files: null as never }).scaffold).toBe(false);
  });
});

describe('hasUserInterface / hasExistingE2e', () => {
  it('recognises the shapes a UI actually takes', () => {
    expect(hasUserInterface({ 'index.html': '' })).toBe(true);
    expect(hasUserInterface({ 'src/App.vue': '' })).toBe(true);
    expect(hasUserInterface({ 'src/Page.svelte': '' })).toBe(true);
    expect(hasUserInterface({ 'server/api.js': '' })).toBe(false);
    expect(hasUserInterface({})).toBe(false);
  });

  it('does not mistake an ordinary unit test for an E2E setup', () => {
    // src/lib/math.test.ts is not an end-to-end suite, and treating it as one would silently skip
    // the scaffold for most projects.
    expect(hasExistingE2e({ 'src/lib/math.test.ts': '' })).toBe(false);
    expect(hasExistingE2e({ 'e2e/smoke.spec.ts': '' })).toBe(true);
  });
});

describe('e2eAutoScaffoldNote — says WRITTEN, never "passed"', () => {
  const note = e2eAutoScaffoldNote(['playwright.config.ts', 'e2e/smoke.spec.ts']);

  it('states plainly that the suite has not been run here', () => {
    // Reporting a scaffold as a passing test run would be exactly the fake success the constitution
    // forbids, and the point of Phase 4 is that "it built" stops standing in for "it works".
    expect(note).toContain('has not been run here');
    expect(note.toLowerCase()).not.toContain('passed');
  });

  it('tells the user exactly how to run it themselves', () => {
    expect(note).toContain('npm run test:e2e');
    expect(note).toContain('playwright install chromium');
  });

  it('names the files it wrote', () => {
    expect(note).toContain('playwright.config.ts');
    expect(note).toContain('e2e/smoke.spec.ts');
  });
});

describe('wired into every build, and honest about what it did', () => {
  const route = readFileSync(join(__dirname, '..', 'routes', 'agentv3.ts'), 'utf8');

  it('runs by default with a kill switch, not on-request', () => {
    // It was a tool the agent MAY call, which in practice meant most apps shipped without one.
    expect(route).toContain("process.env.AGENTV3_AUTO_E2E !== 'off'");
    expect(route).toContain('shouldAutoScaffoldE2e({');
  });

  it('writes create-only, so a file the user owns is never overwritten', () => {
    const at = route.indexOf('AGENTV3_AUTO_E2E');
    const block = route.slice(at, at + 2200);
    expect(block).toContain('if (exists) continue;');
  });

  it('never installs or runs Playwright during the build', () => {
    // The window starts BEFORE the env check: the reasoning lives in the comment above it, and
    // slicing forward from the check would miss the very line being asserted.
    const at = route.indexOf('AGENTV3_AUTO_E2E');
    const block = route.slice(Math.max(0, at - 1200), at + 2200);
    // ~300 MB of browser on every build, for every user, to add a signal the render check, the
    // console capture and the route smoke check largely already give.
    expect(block).not.toContain('playwright install');
    expect(block).not.toContain('npx playwright test');
    expect(block).toContain('Deliberately NOT executed here');
  });

  it('records the SKIP too, with its reason', () => {
    expect(route).toContain("code: 'E2E_SCAFFOLD_SKIPPED'");
    expect(route).toContain('${decision.reason}');
  });
});
