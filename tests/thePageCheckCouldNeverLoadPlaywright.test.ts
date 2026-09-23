import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { playwrightImport } from '../src/server/AgentV3/sandboxBrowserScript';
import { pageCheckScript, TOOLS_DIR } from '../src/server/AgentV3/PageRouteCheck';

/**
 * Autopsy ac41a924 (2026-09-23): PAGE_RENDER_NOT_RUN and JOURNEY_NOT_RUN on a build whose app rendered
 * fine, both carrying the tail *"const { chromium } = pkg;"* — Node's own advice after it refused
 * `import { chromium } from '…/playwright/index.js'`. Playwright's index.js is CommonJS
 * (`module.exports = require('playwright-core')`, which re-exports an object built at run time), so an
 * ES module cannot NAME its exports. Both scripts died at link time, before their first line, on every
 * build.
 *
 * The earlier tests pinned the broken import as a STRING and stayed green throughout. So this suite
 * RUNS the import in a real Node against a package with Playwright's real shape — the only thing that
 * could have caught it.
 */

let root: string;

beforeAll(() => {
  // Playwright's real layout, reduced to the part that matters to the ESM loader.
  root = mkdtempSync(join(tmpdir(), 'nbai-pw-'));
  const pw = join(root, 'node_modules', 'playwright');
  const core = join(pw, 'node_modules', 'playwright-core');
  mkdirSync(join(core, 'lib'), { recursive: true });
  writeFileSync(join(pw, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }));
  writeFileSync(join(pw, 'index.js'), "module.exports = require('playwright-core');\n");
  writeFileSync(join(core, 'package.json'), JSON.stringify({ name: 'playwright-core', main: 'index.js' }));
  writeFileSync(join(core, 'index.js'), "const v = process.versions.node;\nif (!v) {}\nmodule.exports = require('./lib/inprocess');\n");
  writeFileSync(join(core, 'lib', 'inprocess.js'), "function create() { return { chromium: { name: 'chromium' } }; }\nmodule.exports = create();\n");
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

function runModule(source: string): { status: number | null; out: string } {
  const file = join(root, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, source);
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('the import line really loads Playwright in Node', () => {
  it('the OLD named import fails on this shape — the fixture reproduces the production failure', () => {
    const r = runModule(`import { chromium } from '${root}/node_modules/playwright/index.js';\nconsole.log(chromium.name);\n`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Named export 'chromium' not found");
  });

  it('the shared import line loads chromium', () => {
    const r = runModule(`${playwrightImport(root)}\nconsole.log('CHROMIUM=' + chromium.name);\n`);
    expect(r.out).toContain('CHROMIUM=chromium');
    expect(r.status).toBe(0);
  });

  it('the page-check script as generated loads chromium (its real header, pointed at the fixture)', () => {
    const script = pageCheckScript('https://x.e2b.app', ['/a']);
    const body = script.slice(script.indexOf('\n') + 1, script.indexOf('\nNBAI_EOF'));
    const header = body.split('\n').filter((l) => !l.startsWith('//')).slice(0, 2).join('\n').split(TOOLS_DIR).join(root);
    const r = runModule(`${header}\nconsole.log('CHROMIUM=' + chromium.name);\n`);
    expect(r.out).toContain('CHROMIUM=chromium');
  });
});

describe('no in-sandbox script names an export of the CommonJS playwright entry', () => {
  it('every script loads it through the one shared line', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts') || p.includes('.test.')) continue;
        if (/import\s*\{[^}]*\}\s*from\s*['"][^'"]*node_modules\/playwright\//.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(join(__dirname, '..', 'src', 'server'));
    expect(offenders).toEqual([]);
  });
});
