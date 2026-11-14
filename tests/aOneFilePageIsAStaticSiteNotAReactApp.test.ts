// A ONE-FILE PAGE IS A STATIC SITE, NOT A REACT APP (single-file game autopsy, 2026-11-14).
// The admin's imported game previewed as "Blocked request. This host (5173-….e2b.app) is not allowed": the preview boot trusted the
// Pro panel's default `vite-react` LABEL, synthesized a React + Vite project around a canvas game, and the synthesized
// `vite.config.ts` was a drifted copy of the template's — `host: true` with no `allowedHosts`.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isStaticSiteProject, ensureStaticSiteFoundation, ensureViteReactFoundation } from '../src/server/AgentV3/FrameworkFoundation';
import { liftEmbeddedMedia } from '../src/lib/liftEmbeddedMedia';
import { buildGameFixture } from './helpers/singleFileGameFixture';

const PAGE = '<!doctype html><html><body><canvas id="c"></canvas><script>var x = 1;</script></body></html>';

describe('isStaticSiteProject', () => {
  it('the admin\'s game (a lifted one-file page) is a static site', () => {
    const lifted = liftEmbeddedMedia({ 'index.html': buildGameFixture().html });
    expect(isStaticSiteProject(lifted.files)).toBe(true);
  });
  it('plain pages with classic scripts and styles are static', () => {
    expect(isStaticSiteProject({ 'index.html': PAGE, 'script.js': 'var a = 1;', 'style.css': 'body{}' })).toBe(true);
  });
  it('a second boot judges it the same: the static package this module writes is still static', () => {
    const first = ensureStaticSiteFoundation({ 'index.html': PAGE });
    expect(isStaticSiteProject({ 'index.html': PAGE, ...first.files })).toBe(true);
  });
  it('anything that needs a bundler is NOT static', () => {
    expect(isStaticSiteProject({ 'index.html': PAGE, 'src/App.tsx': 'export default 1' })).toBe(false);
    expect(isStaticSiteProject({ 'index.html': PAGE, 'vite.config.ts': 'export default {}' })).toBe(false);
    expect(isStaticSiteProject({ 'index.html': PAGE, 'main.js': "import x from './x.js'" })).toBe(false);
    expect(isStaticSiteProject({ 'index.html': '<script type="module">import a from "./a.js"</script>' })).toBe(false);
    expect(isStaticSiteProject({ 'index.html': PAGE, 'package.json': '{"scripts":{"dev":"vite"},"dependencies":{"react":"18"}}' })).toBe(false);
    expect(isStaticSiteProject({ 'index.html': PAGE, 'api/package.json': '{}' })).toBe(false);
  });
  it('no page, no static site', () => {
    expect(isStaticSiteProject({ 'README.md': '# hi' })).toBe(false);
    expect(isStaticSiteProject({})).toBe(false);
  });
});

describe('ensureStaticSiteFoundation', () => {
  it('writes ONE file: a package.json that serves the folder with http-server on 3000 (never Vite)', () => {
    const r = ensureStaticSiteFoundation({ 'index.html': PAGE });
    expect(r.added).toEqual(['package.json']);
    const pkg = JSON.parse(r.files['package.json']);
    expect(pkg.scripts.dev).toMatch(/^npx http-server \. -p 3000/);
    expect(pkg.scripts.dev).not.toMatch(/ -o\b/); // no browser auto-open in a headless sandbox
    expect(JSON.stringify(pkg)).not.toMatch(/vite|react/i);
  });
  it('never overwrites a package.json, and does nothing for a framework project', () => {
    expect(ensureStaticSiteFoundation({ 'index.html': PAGE, 'package.json': '{"scripts":{"dev":"npx http-server . -p 3000"}}' }).added).toEqual([]);
    expect(ensureStaticSiteFoundation({ 'index.html': PAGE, 'src/App.tsx': 'x' }).added).toEqual([]);
  });
});

describe('the class: a synthesized Vite config can never refuse the preview host', () => {
  it('the React foundation\'s own vite.config.ts carries allowedHosts', () => {
    const r = ensureViteReactFoundation({ 'src/App.tsx': 'import React from "react"; export default function App(){return null}' }, { framework: 'vite-react' });
    expect(r.files['vite.config.ts']).toContain('allowedHosts: true');
  });
  it('census: a source file that writes `host: true` into a Vite config also writes allowedHosts', () => {
    const root = join(__dirname, '..', 'src/server');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
        if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name)) continue;
        const text = readFileSync(p, 'utf8');
        if (/server:\s*\{[^}]*\bhost:\s*true\b/.test(text) && !/allowedHosts/.test(text)) offenders.push(relative(root, p));
      }
    };
    walk(root);
    expect(offenders, 'a Vite config template with host:true must also set allowedHosts, or the E2B preview host is blocked').toEqual([]);
  });
});

describe('the preview boot decides from the FILES, not the label', () => {
  it('preview-diagnose asks isStaticSiteProject before it builds a React foundation', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    const at = route.indexOf('const staticFoundation = ensureStaticSiteFoundation(saved);');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 400)).toContain('isStaticSiteProject(saved) ? staticFoundation : ensureViteReactFoundation(saved, { framework })');
  });
});
