import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { proveBrowserRunnable } from '../src/server/AgentV3/previewCapability';
import { shouldBootImportedProject, type ImportedBootSignals } from '../src/components/agentv3/importedProjectBoot';

/**
 * PHASE 1 of IN_BROWSER_PREVIEW_PLAN.md — "un logo ka bhi dhyan rakhna jo apni already bani hui app
 * (github/zip) navbharatai par layenge".
 *
 * An imported project currently boots a full E2B sandbox and runs npm install before the user can see
 * anything. Unlike a generated build there is no build to run, so for a plain React app somebody only
 * wants to LOOK at, that VM buys nothing.
 *
 * THE PROPERTY THESE TESTS PROTECT, above all others: the prover's default answer is NO. It does not
 * ask "might the browser cope?", it asks "can I PROVE it will?". A wrong "no" costs one VM — today's
 * cost, no regression. A wrong "yes" shows the user a broken app and calls it their app.
 */

const reactApp = {
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div>',
  'src/main.tsx': "import App from './App';",
  'src/App.tsx': 'export default function App() { return <h1>hi</h1>; }',
};

describe('the happy case it exists to serve', () => {
  it('a plain React app is provably runnable', () => {
    const c = proveBrowserRunnable(reactApp);
    expect(c.browserRunnable).toBe(true);
    expect(c.blockers).toEqual([]);
    expect(c.reason).toBe('');
  });

  it('a plain static site too', () => {
    expect(proveBrowserRunnable({ 'index.html': '<h1>hi</h1>', 'style.css': 'h1{}' }).browserRunnable).toBe(true);
  });

  it('a vite.config importing `path` does NOT block it', () => {
    /**
     * The single most common shape in the entire JavaScript ecosystem. Blocking on it would refuse
     * almost every real Vite project — including exactly the ones this feature exists to serve. The
     * import configures the build; it never runs in it.
     */
    const c = proveBrowserRunnable({ ...reactApp, 'vite.config.ts': "import path from 'path';\nexport default {};" });
    expect(c.browserRunnable).toBe(true);
  });
});

describe('every refusal, and why it is a refusal rather than a stub', () => {
  it('a Svelte app — we have no compiler for it', () => {
    const c = proveBrowserRunnable({ ...reactApp, 'src/Card.svelte': '<h1>x</h1>' });
    expect(c.blockers).toContain('unsupported-framework');
    expect(c.browserRunnable).toBe(false);
  });

  it('an app with its own API server', () => {
    const c = proveBrowserRunnable({
      ...reactApp,
      'package.json': JSON.stringify({ dependencies: { react: '18', express: '^4' } }),
    });
    expect(c.blockers).toContain('has-backend');
  });

  it('a package that cannot exist in a browser at any effort', () => {
    const c = proveBrowserRunnable({
      ...reactApp,
      'package.json': JSON.stringify({ dependencies: { react: '18', sharp: '^0.33' } }),
    });
    expect(c.blockers).toContain('node-only-dependency');
  });

  it('APP CODE reaching for a Node builtin — the stub would produce wrong data, silently', () => {
    /**
     * ReactPreview stubs `node:` imports to a proxy returning '' so one stray config import cannot kill
     * a preview. Good narrow guard, and it stays. But for an app that genuinely USES a builtin, that
     * stub hands back '' where a hash belongs and the app renders happily while producing wrong data.
     * Claiming it "runs in the browser" would be precisely "built but not really working".
     */
    const c = proveBrowserRunnable({ ...reactApp, 'src/hash.ts': "import crypto from 'node:crypto';" });
    expect(c.blockers).toContain('node-builtin-import');
    expect(c.reason).toContain('only exist on a real server');
  });

  it('…in both spellings, since both resolve to the same builtin', () => {
    expect(proveBrowserRunnable({ ...reactApp, 'src/f.ts': "import fs from 'fs';" }).blockers).toContain('node-builtin-import');
    expect(proveBrowserRunnable({ ...reactApp, 'src/f.ts': "const fs = require('node:fs/promises');" }).blockers).toContain('node-builtin-import');
  });

  it('a builtin in a server/ or scripts/ folder is not APP code', () => {
    // Those paths are not what the browser would be asked to render, and `has-backend` already speaks
    // for a real server. Double-counting them here would just make the refusal reason less accurate.
    expect(proveBrowserRunnable({ ...reactApp, 'scripts/build.ts': "import fs from 'fs';" }).browserRunnable).toBe(true);
  });

  it('nothing to render from', () => {
    expect(proveBrowserRunnable({ 'README.md': '# hi', 'data.csv': 'a,b' }).blockers).toContain('no-renderable-entry');
  });
});

describe('the default is NO, and it cannot be reached by accident', () => {
  it('an empty tree proves nothing — it must not fall through to "no blockers, therefore runnable"', () => {
    // The whole failure mode in one test: "found no problems" and "proved it works" are different
    // sentences, and only the second one may return true.
    expect(proveBrowserRunnable({}).browserRunnable).toBe(false);
    expect(proveBrowserRunnable(null).browserRunnable).toBe(false);
    expect(proveBrowserRunnable(undefined).browserRunnable).toBe(false);
  });

  it('every blocker is collected, not just the first', () => {
    const c = proveBrowserRunnable({
      'package.json': JSON.stringify({ dependencies: { express: '^4', sharp: '^0.33' } }),
      'src/x.svelte': '<b/>',
    });
    expect(c.blockers.length).toBeGreaterThan(2);
  });

  it('a reason is present exactly when it is not runnable', () => {
    expect(proveBrowserRunnable(reactApp).reason).toBe('');
    expect(proveBrowserRunnable({}).reason).not.toBe('');
  });

  it('no refusal names a vendor or a model — the white-label law holds here too', () => {
    const mod = readFileSync(join(process.cwd(), 'src/server/AgentV3/previewCapability.ts'), 'utf8');
    const reasons = mod.slice(mod.indexOf('const BLOCKER_REASON'), mod.indexOf('export function proveBrowserRunnable'));
    expect(reasons).not.toMatch(/\b(E2B|GLM|Kimi|Claude|Anthropic|Gemini|Grok|esm\.sh|StackBlitz)\b/i);
  });
});

describe('the boot decision — skipping a VM must never strand a user', () => {
  const ready: ImportedBootSignals = {
    bootSignal: 1_700_000_000_000, bootedFor: 0, workspaceId: 'ws-1', livePreviewAvailable: true,
  };

  it('a provably-runnable import starts NO sandbox', () => {
    expect(shouldBootImportedProject({ ...ready, browserRunnable: true })).toBe(false);
  });

  it('an import the prover refused boots exactly as before', () => {
    expect(shouldBootImportedProject({ ...ready, browserRunnable: false })).toBe(true);
  });

  it('null WAITS — a verdict in flight must not cause a boot for timing reasons alone', () => {
    expect(shouldBootImportedProject({ ...ready, browserRunnable: null })).toBe(false);
  });

  it('UNDEFINED is not null: "nobody asked" falls through to today\'s behaviour', () => {
    /**
     * The load-bearing distinction. If undefined meant "wait", an import made while the user sits on
     * the Live tab — where nothing ever requests a verdict — would wait forever for an answer that is
     * never coming. A preview that never boots is a worse failure than a sandbox we did not need.
     */
    expect(shouldBootImportedProject(ready)).toBe(true);
    expect(shouldBootImportedProject({ ...ready, browserRunnable: undefined })).toBe(true);
  });

  it('the older guards still hold ahead of the new one', () => {
    expect(shouldBootImportedProject({ ...ready, browserRunnable: false, bootSignal: 0 })).toBe(false);
    expect(shouldBootImportedProject({ ...ready, browserRunnable: false, workspaceId: '' })).toBe(false);
    expect(shouldBootImportedProject({ ...ready, browserRunnable: false, bootedFor: ready.bootSignal as number })).toBe(false);
  });
});

describe('the wiring', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

  it('the verdict rides the response the client already asks for — no extra round trip', () => {
    expect(route).toContain('const capability = proveBrowserRunnable(files)');
    // BOTH exits — the cached one and the fresh one. A verdict present on only one of them would make
    // the boot depend on whether a render happened to be cached, which is not a property of the app.
    expect((route.match(/browserRunnable: capability\.browserRunnable/g) || []).length).toBe(2);
  });

  it('the client accepts only an explicit boolean', () => {
    // An older server that does not send the field leaves this null ("pending"), never a verdict it
    // never gave.
    expect(surface).toContain("typeof data.browserRunnable === 'boolean' ? data.browserRunnable : null");
  });

  it('the verdict is passed only from the tab that can produce one', () => {
    expect(surface).toContain("browserRunnable: mode === 'inbrowser' ? browserRunnable : undefined");
  });

  it('skipping the boot leaves the on-demand sandbox button in place', () => {
    /**
     * This is what makes Phase 1 a change of WHEN a sandbox starts and not WHETHER the user can have
     * one. Remove this button and the phase becomes a capability removal.
     */
    expect(surface).toContain("{diagnosing ? 'Starting the live server…' : 'Diagnose'}");
    // `true` = a PERSON pressed it, which the server treats as a build-quality signal (the watchdog passes false).
    expect(surface).toContain('onClick={() => void runDiagnose(true)}');
  });

  it('a refusal is shown to the user with its real reason', () => {
    expect(surface).toContain('browserRunnable === false && !hasBackend && browserBlockedReason');
  });
});
