import { describe, it, expect } from 'vitest';
import { planDependencyAutoFix, applyWellKnownMissingDeps, WELL_KNOWN_DEPS, WELL_KNOWN_DEV_DEPS, pinKnownDepsInPackageJson, pinKnownDepsInInstallCommand, ensureFrameworkCoreDeps, npmInstallMaskedFailure } from './DependencyAutoFix';

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

describe('pinKnownDepsInInstallCommand — react-leaflet peer-conflict pin (CargoPilot autopsy)', () => {
  it('pins the EXACT CargoPilot install so react-leaflet@5 (needs react@19) can never brick a react-18 app', () => {
    // The real failing command: bare `react-leaflet`/`leaflet` → npm pulled 5.x → ERESOLVE (peer react@^19).
    const cmd =
      'npm install @prisma/client prisma stripe bcryptjs socket.io socket.io-client lucide-react leaflet react-leaflet leaflet-defaulticon-compatibility tailwindcss-animate clsx class-variance-authority @radix-ui/react-slot 2>&1 | tail -30';
    const out = pinKnownDepsInInstallCommand(cmd);
    expect(out).toContain('react-leaflet@^4'); // pinned to the react-18-compatible major
    expect(out).toContain('leaflet@^1');
    expect(out).toContain('prisma@^6'); // existing pins still applied
    expect(out).toContain('socket.io@^4');
  });

  it('leaves an explicitly-versioned react-leaflet untouched', () => {
    expect(pinKnownDepsInInstallCommand('npm install react-leaflet@5')).toBe('npm install react-leaflet@5');
  });

  it('pins bare tailwindcss to v3 so the v3 CLI/directives work (LedgerLoop autopsy)', () => {
    // The real LedgerLoop install: bare `tailwindcss` → npm pulled v4 → `tailwindcss init -p` gone.
    const out = pinKnownDepsInInstallCommand('npm install lucia prisma zod @prisma/client tailwindcss postcss autoprefixer');
    expect(out).toContain('tailwindcss@^3');
    expect(out).toContain('prisma@^6'); // existing pins still applied
    // an explicit tailwind version is respected
    expect(pinKnownDepsInInstallCommand('npm install -D tailwindcss@4')).toBe('npm install -D tailwindcss@4');
  });
});

describe('ensureFrameworkCoreDeps — the framework binary can never vanish (CargoPilot dev-server-death)', () => {
  it('re-adds `next` when a rewritten Next.js package.json dropped it (the exact failure)', () => {
    const pj = JSON.stringify({ name: 'app', dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', stripe: '^16' } }, null, 2);
    const r = ensureFrameworkCoreDeps(pj, 'nextjs');
    expect(r.added).toContain('next@^14');
    expect(JSON.parse(r.content).dependencies.next).toBe('^14');
    // untouched deps preserved, react not re-added (already present)
    expect(JSON.parse(r.content).dependencies.stripe).toBe('^16');
    expect(r.added).not.toContain('react@^18');
  });

  it('is ADD-ONLY — never downgrades an existing (even newer) core dep', () => {
    const pj = JSON.stringify({ name: 'app', dependencies: { next: '^15', react: '^19', 'react-dom': '^19' } }, null, 2);
    const r = ensureFrameworkCoreDeps(pj, 'nextjs');
    expect(r.added).toEqual([]);
    expect(r.content).toBe(pj); // byte-identical — nothing to do
  });

  it('counts a core dep in devDependencies as present (does not duplicate it)', () => {
    const pj = JSON.stringify({ name: 'app', dependencies: {}, devDependencies: { vite: '^5', react: '^18', 'react-dom': '^18' } }, null, 2);
    const r = ensureFrameworkCoreDeps(pj, 'vite-react');
    expect(r.added).toEqual([]);
  });

  it('no-ops for an unknown framework and for non-JSON input', () => {
    expect(ensureFrameworkCoreDeps('{}', 'brand-new-framework').added).toEqual([]);
    expect(ensureFrameworkCoreDeps('not json', 'nextjs').added).toEqual([]);
    expect(ensureFrameworkCoreDeps('{}', undefined).added).toEqual([]);
  });
});

describe('npmInstallMaskedFailure — an exit-0 pipe can hide a real npm failure (CargoPilot)', () => {
  it('flags the EXACT masked ERESOLVE the build swallowed', () => {
    const cmd = 'npm install react-leaflet 2>&1 | tail -30';
    const out = 'npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree\nnpm error peer react@"^19.0.0" from react-leaflet@5.0.0';
    expect(npmInstallMaskedFailure(cmd, out)).toBe(true);
  });

  it('does NOT flag a clean piped install', () => {
    expect(npmInstallMaskedFailure('npm install 2>&1 | tail -20', 'added 71 packages, and audited 100 packages in 18s')).toBe(false);
  });

  it('does NOT flag an install that is NOT piped (the real exit code is already visible)', () => {
    expect(npmInstallMaskedFailure('npm install react-leaflet', 'npm error code ERESOLVE')).toBe(false);
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

describe('pinKnownDepsInPackageJson (LearnLoop autopsy — force Prisma → ^6 in the written package.json)', () => {
  it('rewrites a breaking-major Prisma pin (^7 / latest) down to the known-good major', () => {
    const src = JSON.stringify({ name: 'app', dependencies: { prisma: '^7', '@prisma/client': 'latest', react: '^18' } }, null, 2);
    const { content, changed } = pinKnownDepsInPackageJson(src);
    const pkg = JSON.parse(content);
    expect(pkg.dependencies.prisma).toBe('^6');
    expect(pkg.dependencies['@prisma/client']).toBe('^6');
    expect(pkg.dependencies.react).toBe('^18'); // untouched — not a force-pinned dep
    expect(changed.length).toBe(2);
  });

  it('leaves an already-good major (^6.19.3) alone (no churn)', () => {
    const src = JSON.stringify({ dependencies: { prisma: '6.19.3', '@prisma/client': '^6' } }, null, 2);
    const { content, changed } = pinKnownDepsInPackageJson(src);
    expect(changed).toEqual([]);
    expect(content).toBe(src); // byte-identical when nothing changed
  });

  it('pins a Prisma dep declared under devDependencies too', () => {
    const src = JSON.stringify({ devDependencies: { prisma: '^7.8.0' } }, null, 2);
    const { content, changed } = pinKnownDepsInPackageJson(src);
    expect(JSON.parse(content).devDependencies.prisma).toBe('^6');
    expect(changed.length).toBe(1);
  });

  it('returns the input unchanged for non-JSON / a package.json without the force-pinned deps', () => {
    expect(pinKnownDepsInPackageJson('not json {').changed).toEqual([]);
    const clean = JSON.stringify({ dependencies: { react: '^18' } }, null, 2);
    expect(pinKnownDepsInPackageJson(clean)).toEqual({ content: clean, changed: [] });
  });
});

describe('a test suite the app cannot run is worse than no test suite', () => {
  /**
   * ADMIN BUILD REPORT 2026-08-24 — and the build's OWN REVIEWER caught it before we did:
   *   "Test file imports vitest but the package is not listed in package.json devDependencies. The
   *    `declare module 'vitest'` block at the top is a workaround for missing types."
   * The vaccine then recorded TEST_SUITE_UNVERIFIED: a suite that exists and cannot run, which looks
   * like coverage and proves nothing.
   *
   * The reconciler that should have caught this has worked since 2026-07-13 and simply had no test
   * packages in its allowlist — so the app that most needed it, one the engine had just written tests
   * for, was the single shape it could not see.
   */
  it('declares the test packages the build itself imported', () => {
    const r = applyWellKnownMissingDeps({
      'package.json': pkg({ next: '14' }),
      'app/page.test.tsx': "import { describe, it } from 'vitest';",
      'e2e/smoke.spec.ts': "import { test } from '@playwright/test';",
    });
    const out = JSON.parse(r.files['package.json']);
    expect(out.devDependencies).toHaveProperty('vitest');
    expect(out.devDependencies).toHaveProperty('@playwright/test');
  });

  it('puts them in devDependencies, NEVER in dependencies', () => {
    // The section is part of the fix. A test runner in `dependencies` ships to production and bloats
    // every install — exactly what a careful reviewer flags next.
    const r = applyWellKnownMissingDeps({
      'package.json': pkg({}),
      'a.test.ts': "import { expect } from 'vitest';",
    });
    const out = JSON.parse(r.files['package.json']);
    expect(out.dependencies).not.toHaveProperty('vitest');
    expect(out.devDependencies).toHaveProperty('vitest');
  });

  it('still routes a runtime package to dependencies in the same pass', () => {
    const r = applyWellKnownMissingDeps({
      'package.json': pkg({}),
      'a.tsx': "import axios from 'axios';",
      'a.test.tsx': "import { it } from 'vitest';",
    });
    const out = JSON.parse(r.files['package.json']);
    expect(out.dependencies).toHaveProperty('axios');
    expect(out.devDependencies).toHaveProperty('vitest');
    expect(out.devDependencies).not.toHaveProperty('axios');
  });

  it('never overwrites a version the project already chose, in any section', () => {
    const r = applyWellKnownMissingDeps({
      'package.json': JSON.stringify({ name: 'a', dependencies: {}, devDependencies: { vitest: '^1.2.3' } }, null, 2),
      'a.test.ts': "import { it } from 'vitest';",
    });
    expect(JSON.parse(r.files['package.json']).devDependencies.vitest).toBe('^1.2.3');
    expect(r.added.find((a) => a.package === 'vitest')).toBeUndefined();
  });

  it('does not invent an empty devDependencies block when nothing needed one', () => {
    const r = applyWellKnownMissingDeps({
      'package.json': pkg({}),
      'a.tsx': "import axios from 'axios';",
    });
    expect(JSON.parse(r.files['package.json'])).not.toHaveProperty('devDependencies');
  });

  it('the two allowlists never disagree about a package', () => {
    // One name in both would make the section it lands in depend on lookup order — a bug that would
    // only ever show up as a mysteriously bloated production install.
    for (const name of Object.keys(WELL_KNOWN_DEV_DEPS)) {
      expect(WELL_KNOWN_DEPS, `${name} is in both allowlists`).not.toHaveProperty(name);
    }
  });
});
