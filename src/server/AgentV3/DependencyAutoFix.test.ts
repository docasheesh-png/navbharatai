import { describe, it, expect } from 'vitest';
import { planDependencyAutoFix, applyWellKnownMissingDeps, WELL_KNOWN_DEPS } from './DependencyAutoFix';

const pkg = (deps: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'app', version: '0.1.0', dependencies: deps, ...extra }, null, 2);

describe('planDependencyAutoFix — partition missing deps into allowlisted vs needs-review', () => {
  it('sends a well-known package to autofixable and an alias-looking name to needsReview', () => {
    const plan = planDependencyAutoFix([
      { kind: 'missing', package: 'axios', severity: 'high', detail: '' },
      { kind: 'missing', package: 'components/Button', severity: 'high', detail: '' },
    ]);
    expect(plan.autofixable).toEqual([{ package: 'axios', version: WELL_KNOWN_DEPS.axios }]);
    expect(plan.needsReview).toEqual(['components/Button']);
  });
});

describe('applyWellKnownMissingDeps — deterministically add allowlisted missing deps to package.json', () => {
  it('adds a well-known package that is imported but not declared', () => {
    const files = {
      'package.json': pkg({ react: '^18.3.1' }),
      'src/api.ts': `import axios from 'axios';\nexport const c = axios.create();`,
    };
    const r = applyWellKnownMissingDeps(files);
    expect(r.added).toEqual([{ package: 'axios', version: WELL_KNOWN_DEPS.axios }]);
    const out = JSON.parse(r.files['package.json']);
    expect(out.dependencies.axios).toBe(WELL_KNOWN_DEPS.axios);
    expect(out.dependencies.react).toBe('^18.3.1'); // existing deps preserved
  });

  it('handles scoped packages and subpath imports (resolves to the package root)', () => {
    const files = {
      'package.json': pkg(),
      'src/q.ts': `import { QueryClient } from '@tanstack/react-query';\nimport { z } from 'zod/lib';\nnew QueryClient(); z;`,
    };
    const r = applyWellKnownMissingDeps(files);
    const names = r.added.map((a) => a.package).sort();
    expect(names).toContain('@tanstack/react-query');
    expect(names).toContain('zod');
  });

  it('is idempotent — never re-adds or overwrites a package already declared (incl. devDependencies)', () => {
    const files = {
      'package.json': pkg({ axios: '^0.27.0' }, { devDependencies: { zustand: '^4.0.0' } }),
      'src/a.ts': `import axios from 'axios';\nimport { create } from 'zustand';\naxios; create;`,
    };
    const r = applyWellKnownMissingDeps(files);
    expect(r.added).toHaveLength(0); // both already declared → no change
    expect(r.files['package.json']).toBe(files['package.json']);
  });

  it('never adds a needs-review name (a bare local alias is NOT an npm package)', () => {
    const files = {
      'package.json': pkg(),
      'src/App.tsx': `import { Button } from 'components/Button';\nBrelated; Button;`,
    };
    const r = applyWellKnownMissingDeps(files);
    expect(r.added).toHaveLength(0);
    expect(r.files).toBe(files); // unchanged reference — nothing safely addable
  });

  it('ignores node builtins and local/relative/@ imports', () => {
    const files = {
      'package.json': pkg(),
      'src/s.ts': `import fs from 'node:fs';\nimport path from 'path';\nimport x from './local';\nimport y from '@/lib/util';\nfs; path; x; y;`,
    };
    const r = applyWellKnownMissingDeps(files);
    expect(r.added).toHaveLength(0);
  });

  it('sorts the dependencies block for a clean diff and appends a trailing newline', () => {
    const files = {
      'package.json': pkg({ zustand: '^4' }),
      'src/a.ts': `import axios from 'axios';\nimport { create } from 'zustand';\naxios; create;`,
    };
    const r = applyWellKnownMissingDeps(files);
    const keys = Object.keys(JSON.parse(r.files['package.json']).dependencies);
    expect(keys).toEqual(['axios', 'zustand']); // alphabetical
    expect(r.files['package.json'].endsWith('\n')).toBe(true);
  });

  it('returns input unchanged when package.json is missing or unparseable', () => {
    expect(applyWellKnownMissingDeps({ 'src/a.ts': `import axios from 'axios';` }).added).toHaveLength(0);
    const bad = { 'package.json': '{ not json', 'src/a.ts': `import axios from 'axios';` };
    const r = applyWellKnownMissingDeps(bad);
    expect(r.added).toHaveLength(0);
    expect(r.files).toBe(bad);
  });

  it('auto-declares a backend package imported but missing (TaskFlow socket.io wall)', () => {
    const files = {
      'package.json': JSON.stringify({ name: 'app', dependencies: { express: '^4' } }),
      'server/socket.ts': `import { Server } from 'socket.io';
export const io = new Server();`,
      'server/auth.ts': `import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';`,
    };
    const r = applyWellKnownMissingDeps(files);
    const deps = JSON.parse(r.files['package.json']).dependencies;
    expect(deps['socket.io']).toBeDefined();
    expect(deps.bcrypt).toBeDefined();
    expect(deps.jsonwebtoken).toBeDefined();
    expect(deps.express).toBe('^4'); // already present — untouched
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error malformed
    expect(() => applyWellKnownMissingDeps(null)).not.toThrow();
    expect(() => applyWellKnownMissingDeps({})).not.toThrow();
  });
});

// Quiz-app autopsy 2026-07-17: the interrupted original build shipped a package.json WITHOUT
// react-router-dom while App.tsx imported it — the next session's dev server crashed on it and an
// LLM round was spent on `npm install react-router-dom`. This is the exact input the (now also
// pre-flight, guardian-site) reconcile must fix deterministically.
describe('quiz-app regression — react-router-dom imported but missing from package.json', () => {
  it('adds react-router-dom to dependencies', () => {
    const files = {
      'package.json': JSON.stringify({ name: 'quiz', dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
      'src/App.tsx': `import { BrowserRouter, Routes, Route } from 'react-router-dom';\nexport default function App() { return null; }`,
    };
    const r = applyWellKnownMissingDeps(files);
    expect(r.added.map((a) => a.package)).toContain('react-router-dom');
    expect(JSON.parse(r.files['package.json']).dependencies['react-router-dom']).toBeTruthy();
  });
});
