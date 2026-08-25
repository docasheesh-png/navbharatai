import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { uiWithoutBuildVerdict, hasFrontendBuilder } from '../src/server/AgentV3/uiWithoutBuild';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';

/**
 * ⚠️ THE SHARED CAUSE BEHIND TWO SEPARATE ADMIN REPORTS (2026-08-25), found by reading the scaffold
 * rather than by guessing at either symptom.
 *
 * The `node-express` template ships exactly three files — package.json, tsconfig.json, src/index.ts.
 * No Vite. No index.html. No React. Its build script is `esbuild --platform=node`, which produces a
 * NODE BUNDLE, not a website.
 *
 * So React components written into that workspace are DEAD BY CONSTRUCTION, and both symptoms follow:
 *   • the preview lands on the Express port and shows `{"error":"Not found"}` — correct, because
 *     there genuinely is no page (#2666)
 *   • publish runs the build, gets no web output, and ships the starter page (#2656)
 *
 * Neither was diagnosable from its own symptom. This checks the CONDITION instead.
 */
const EXPRESS_PKG = JSON.stringify({
  name: 'my-express-api',
  scripts: { dev: 'npx ts-node src/index.ts', build: 'npx esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js' },
  dependencies: { express: '^4.18.2', cors: '^2.8.5' },
});

describe('a user interface with nothing to build or serve it', () => {
  it('catches the exact shape both reports came from', () => {
    const v = uiWithoutBuildVerdict({
      paths: ['package.json', 'tsconfig.json', 'src/index.ts', 'src/ErrorBoundary.tsx', 'src/components/UpiForm.tsx'],
      packageJsonFiles: [EXPRESS_PKG],
    });
    expect(v.stranded).toBe(true);
    expect(v.examples).toContain('src/ErrorBoundary.tsx');
    expect(v.message).toContain('never compiled and never served');
  });

  it('needs ALL THREE conditions — any one absent and the project is fine', () => {
    const base = ['package.json', 'src/index.ts', 'src/App.tsx'];
    // 1. no UI source at all → an ordinary API
    expect(uiWithoutBuildVerdict({ paths: ['package.json', 'src/index.ts'], packageJsonFiles: [EXPRESS_PKG] }).stranded).toBe(false);
    // 2. a frontend builder is declared → an ordinary web app
    expect(uiWithoutBuildVerdict({
      paths: base,
      packageJsonFiles: [JSON.stringify({ devDependencies: { vite: '^5.0.0' } })],
    }).stranded).toBe(false);
    // 3. an index.html exists → there IS a page
    expect(uiWithoutBuildVerdict({ paths: [...base, 'index.html'], packageJsonFiles: [EXPRESS_PKG] }).stranded).toBe(false);
  });

  it('a MONOREPO is not accused — one builder anywhere clears the project', () => {
    // The root package.json has no builder; `client/` does. Judging by the root alone would accuse a
    // perfectly ordinary layout, which is why every package.json is read.
    expect(uiWithoutBuildVerdict({
      paths: ['package.json', 'server/index.ts', 'client/package.json', 'client/src/App.tsx'],
      packageJsonFiles: [EXPRESS_PKG, JSON.stringify({ devDependencies: { vite: '^5' } })],
    }).stranded).toBe(false);
  });

  it('ignores vendor and build output — a .tsx inside node_modules is not the user\'s app', () => {
    expect(uiWithoutBuildVerdict({
      paths: ['package.json', 'src/index.ts', 'node_modules/react/x.tsx', 'dist/y.jsx'],
      packageJsonFiles: [EXPRESS_PKG],
    }).stranded).toBe(false);
  });

  it('does not treat .ts as a user interface — an API is full of it', () => {
    expect(uiWithoutBuildVerdict({
      paths: ['package.json', 'src/index.ts', 'src/routes/upi.ts', 'src/lib/qr.ts'],
      packageJsonFiles: [EXPRESS_PKG],
    }).stranded).toBe(false);
  });
});

describe('hasFrontendBuilder reads deps AND scripts', () => {
  it('finds a builder declared as a dependency', () => {
    expect(hasFrontendBuilder([JSON.stringify({ dependencies: { next: '^14' } })])).toBe(true);
    expect(hasFrontendBuilder([JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2' } })])).toBe(true);
  });

  it('...and one only ever invoked through a script', () => {
    // Some projects call it with npx and never declare it. Missing that would be a false accusation.
    expect(hasFrontendBuilder([JSON.stringify({ scripts: { build: 'npx vite build' } })])).toBe(true);
  });

  it('an unreadable package.json is not evidence of absence', () => {
    expect(hasFrontendBuilder(['{ not json'])).toBe(false);
    expect(hasFrontendBuilder([])).toBe(false);
  });

  it('does NOT count the express build — esbuild --platform=node makes a server, not a site', () => {
    // The precise trap: `esbuild` looks like a bundler and is one, just not for the web. Counting it
    // would have cleared the very project this module exists for.
    expect(hasFrontendBuilder([EXPRESS_PKG])).toBe(false);
  });
});

describe('and the builder is warned BEFORE it writes them (the prevention half)', () => {
  it('the express scaffolding note says the template cannot serve a page', () => {
    const p = architectSystemPrompt('node-express');
    expect(p).toContain('THIS TEMPLATE IS API-ONLY');
    expect(p).toContain('NEVER compiled and NEVER served');
    // And what to do instead — a warning with no instruction just produces a confident wrong choice.
    expect(p).toContain('ask the user to start it as a web app instead');
  });

  it('the finding is wired as advisory, never as a blocker', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("code: 'UI_WITHOUT_BUILD'");
    expect(route).toContain("severity: 'warning'");
    // A project mid-way to a frontend is a legitimate state; refusing to save someone's work over a
    // layout opinion would be worse than saying so plainly.
    expect(route).not.toContain('throw new Error(stranded.message)');
  });
});

/**
 * HUNTING THE SIBLINGS (rule 3). The warning first went on `node-express` alone, because that is the
 * template the two reports came from. But EVERY backend-only scaffold has the same shape — no
 * index.html, no frontend build — so a user who asks a Fastify or Django project for a screen hits the
 * identical dead end.
 *
 * The DETECTOR was always framework-agnostic and caught them all. Only the prevention half was
 * one-template-deep, which is the more expensive half to miss: detection tells the user afterwards,
 * prevention stops the wasted build.
 */
describe('every API-only scaffold warns, not just the one that was reported', () => {
  const BACKEND_ONLY = ['node-express', 'nestjs', 'fastify', 'python-fastapi', 'django', 'flask', 'spring-boot', 'go'];

  it.each(BACKEND_ONLY)('%s says it cannot serve a page, and what to do instead', (fw) => {
    const p = architectSystemPrompt(fw);
    expect(p).toContain('THIS TEMPLATE IS API-ONLY');
    expect(p).toContain('NEVER compiled and NEVER served');
    expect(p).toContain('ask the user to start it as a web app instead');
  });

  it.each(['vite-react', 'nextjs', 'vue', 'svelte', 'astro', 'vanilla', 'static'])(
    '%s does NOT carry the warning — it can serve a page',
    (fw) => {
      // The warning must never appear on a web framework: it would tell a builder to refuse the very
      // thing that template exists for.
      expect(architectSystemPrompt(fw)).not.toContain('THIS TEMPLATE IS API-ONLY');
    },
  );
});
