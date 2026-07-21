import { describe, it, expect } from 'vitest';
import {
  stripPrismaSqliteEnums,
  fixPrismaSqliteScalarList,
  fixCjsDefaultImport,
  fixPrismaDateStringDefault,
  fixPrismaSeedRunner,
  dedupeSameModuleImports,
  ensureViteTypeModule,
  applyFullStackGuards,
  fullStackGuardsEnabled,
} from './FullStackGuards';

describe('dedupeSameModuleImports — kill "Duplicate declaration" (Bazaar-era autopsy)', () => {
  it('removes a duplicate same-name import of the same module (the exact ErrorBoundary crash)', () => {
    const src = `import App from './App';\nimport ErrorBoundary from './ErrorBoundary';\nimport { ErrorBoundary } from "./ErrorBoundary";\n`;
    const out = dedupeSameModuleImports('src/main.tsx', src);
    expect(out).toContain("import ErrorBoundary from './ErrorBoundary';");
    expect(out).not.toMatch(/\{\s*ErrorBoundary\s*\}/); // the duplicate named import is gone
    expect(out.split('\n').filter((l) => /ErrorBoundary/.test(l) && /^\s*import\b/.test(l)).length).toBe(1); // one import line binds it
  });

  it('keeps the surviving named specifiers when only one is a duplicate', () => {
    const out = dedupeSameModuleImports('a.tsx', `import ErrorBoundary from './EB';\nimport { ErrorBoundary, Foo } from './EB';`);
    expect(out).toContain("import ErrorBoundary from './EB';");
    expect(out).toContain("import { Foo } from './EB';");
  });

  it('NEVER touches a same-name import from a DIFFERENT module (a real conflict — reconciler owns it)', () => {
    const src = `import X from './a';\nimport { X } from './b';`;
    expect(dedupeSameModuleImports('a.tsx', src)).toBe(src);
  });

  it('leaves side-effect and non-code files alone', () => {
    const src = `import './styles.css';\nimport App from './App';`;
    expect(dedupeSameModuleImports('a.tsx', src)).toBe(src);
    expect(dedupeSameModuleImports('readme.md', src)).toBe(src);
  });

  it('runs through applyFullStackGuards (wired, flag-gated)', () => {
    const src = `import EB from './EB';\nimport { EB } from './EB';`;
    expect((applyFullStackGuards('src/main.tsx', src).match(/EB/g) || []).length).toBe(2); // one import line, module+name once each
    expect(applyFullStackGuards('src/main.tsx', src, { AGENTV3_FULLSTACK_GUARDS: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(src);
  });
});

// The exact TaskFlow failures (build report 2026-07-17): Prisma-on-SQLite rejected `enum TaskStatus`
// ("the current connector does not support enums") and the seed crashed with
// "bcrypt.hash is not a function" — both cost multiple read→edit→retry rounds. These guards make the
// FIRST write correct on every full-stack app.

const SQLITE_SCHEMA = `datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum TaskStatus {
  TODO
  IN_PROGRESS
  DONE
}

model Task {
  id     String     @id @default(cuid())
  title  String
  status TaskStatus @default(TODO)
}`;

describe('stripPrismaSqliteEnums', () => {
  it('removes the enum block and rewrites the field to String with a quoted default (the TaskFlow wall)', () => {
    const out = stripPrismaSqliteEnums('prisma/schema.prisma', SQLITE_SCHEMA);
    expect(out).not.toContain('enum TaskStatus');
    expect(out).not.toMatch(/status\s+TaskStatus/);
    expect(out).toMatch(/status\s+String\s+@default\("TODO"\)/);
  });

  it('leaves a POSTGRES schema untouched (Postgres supports enums)', () => {
    const pg = SQLITE_SCHEMA.replace('"sqlite"', '"postgresql"');
    expect(stripPrismaSqliteEnums('prisma/schema.prisma', pg)).toBe(pg);
  });

  it('is a no-op for a sqlite schema with no enums, and for non-schema files', () => {
    const noEnum = `datasource db {\n  provider = "sqlite"\n}\nmodel A { id String @id }`;
    expect(stripPrismaSqliteEnums('prisma/schema.prisma', noEnum)).toBe(noEnum);
    expect(stripPrismaSqliteEnums('src/App.tsx', SQLITE_SCHEMA)).toBe(SQLITE_SCHEMA); // wrong path — untouched
  });

  it('handles an optional enum field (TaskStatus?) too', () => {
    const opt = SQLITE_SCHEMA.replace('status TaskStatus @default(TODO)', 'status TaskStatus?');
    const out = stripPrismaSqliteEnums('prisma/schema.prisma', opt);
    expect(out).toMatch(/status\s+String\?/);
  });
});

// LearnLoop autopsy 2026-07-21: on a SQLite datasource the builder modelled `attachments String[]` etc.
// SQLite has NO scalar lists → `prisma validate` failed ("can't be a list. The current connector does not
// support lists of primitive types"), looping DB setup. The guard collapses every scalar list to `String?`
// (a serialized string) while leaving relation lists — which ARE valid on SQLite — untouched.
describe('fixPrismaSqliteScalarList — SQLite has no scalar lists (LearnLoop autopsy)', () => {
  const P = 'prisma/schema.prisma';
  const wrap = (fields: string) =>
    `datasource db {\n  provider = "sqlite"\n  url = env("DATABASE_URL")\n}\nmodel Lesson {\n${fields}\n}`;

  it('rewrites a String[] scalar list to String?', () => {
    const out = fixPrismaSqliteScalarList(P, wrap('  id String @id\n  attachments String[]'));
    expect(out).toMatch(/attachments\s+String\?/);
    expect(out).not.toMatch(/attachments\s+String\[\]/);
  });

  it('rewrites Int[]/Float[]/Boolean[]/Json[] scalar lists and drops @default([])', () => {
    const out = fixPrismaSqliteScalarList(P, wrap('  scores Int[]\n  tags String[] @default([])\n  flags Boolean[]'));
    expect(out).toMatch(/scores\s+String\?/);
    expect(out).toMatch(/flags\s+String\?/);
    expect(out).toMatch(/tags\s+String\?/);
    expect(out).not.toContain('@default([])');
  });

  it('LEAVES a relation list (Model[]) alone — relations are valid on SQLite', () => {
    const out = fixPrismaSqliteScalarList(P, wrap('  id String @id\n  students User[]\n  quizzes Quiz[]'));
    expect(out).toMatch(/students\s+User\[\]/);
    expect(out).toMatch(/quizzes\s+Quiz\[\]/);
  });

  it('finishes the job for an enum LIST: stripPrismaSqliteEnums makes it String[], scalar-list makes it String?', () => {
    const schema = `datasource db {\n  provider = "sqlite"\n  url = env("DATABASE_URL")\n}\nenum Tag {\n  A\n  B\n}\nmodel Post {\n  id String @id\n  tags Tag[]\n}`;
    const after = fixPrismaSqliteScalarList(P, stripPrismaSqliteEnums(P, schema));
    expect(after).not.toContain('Tag[]');
    expect(after).not.toContain('String[]');
    expect(after).toMatch(/tags\s+String\?/);
  });

  it('is a no-op for POSTGRES (supports scalar lists), non-schema files, and a schema with no scalar list', () => {
    const pg = wrap('  attachments String[]').replace('"sqlite"', '"postgresql"');
    expect(fixPrismaSqliteScalarList(P, pg)).toBe(pg);
    expect(fixPrismaSqliteScalarList('src/App.tsx', wrap('  attachments String[]'))).toBe(wrap('  attachments String[]'));
    const clean = wrap('  id String @id\n  title String');
    expect(fixPrismaSqliteScalarList(P, clean)).toBe(clean);
  });

  it('rides applyFullStackGuards end-to-end (no scalar list survives on a SQLite schema)', () => {
    const out = applyFullStackGuards(P, wrap('  id String @id\n  attachments String[]'));
    expect(out).not.toContain('String[]');
    expect(out).toMatch(/attachments\s+String\?/);
  });
});

describe('fixCjsDefaultImport', () => {
  it('converts `import * as bcrypt` to a default import (kills "bcrypt.hash is not a function")', () => {
    const src = `import * as bcrypt from 'bcrypt';\nconst h = await bcrypt.hash(pw, 10);`;
    const out = fixCjsDefaultImport('prisma/seed.ts', src);
    expect(out).toContain(`import bcrypt from 'bcrypt';`);
    expect(out).toContain('bcrypt.hash(pw, 10)'); // usage untouched — only the import line changes
  });

  it('also fixes bcryptjs and jsonwebtoken (double-quote form preserved)', () => {
    expect(fixCjsDefaultImport('a.ts', `import * as jwt from "jsonwebtoken";`)).toBe(`import jwt from "jsonwebtoken";`);
    expect(fixCjsDefaultImport('a.ts', `import * as bcrypt from "bcryptjs";`)).toBe(`import bcrypt from "bcryptjs";`);
  });

  it('NEVER touches a legitimate namespace import (React, fs, a local module)', () => {
    const keep = `import * as React from 'react';\nimport * as fs from 'fs';\nimport * as utils from './utils';`;
    expect(fixCjsDefaultImport('a.tsx', keep)).toBe(keep);
  });
});

describe('fixPrismaDateStringDefault — a date field defaulted to now() must be DateTime (MediConnect autopsy)', () => {
  // The exact MediConnect failure: `createdAt String @default(now())` → prisma generate fails with
  // "The function `now()` cannot be used on fields of type `String`" (19 such errors).
  const BROKEN = `model Message {
  id        String   @id @default(cuid())
  notes     String?
  createdAt String   @default(now())
  updatedAt String   @updatedAt
  isTyping  Boolean  @default(false)
}`;

  it('rewrites String→DateTime for @default(now()) and @updatedAt fields, keeping optionality', () => {
    const out = fixPrismaDateStringDefault('prisma/schema.prisma', BROKEN);
    expect(out).toContain('createdAt DateTime   @default(now())');
    expect(out).toContain('updatedAt DateTime   @updatedAt');
  });

  it('leaves ordinary String fields and non-date defaults untouched', () => {
    const out = fixPrismaDateStringDefault('prisma/schema.prisma', BROKEN);
    expect(out).toContain('notes     String?');            // a plain optional String — unchanged
    expect(out).toContain('isTyping  Boolean  @default(false)'); // not a String field
    expect(out).toContain('id        String   @id @default(cuid())'); // @default(cuid()) is a valid String default
  });

  it('is a no-op for a non-schema path or content without the bug', () => {
    expect(fixPrismaDateStringDefault('src/App.tsx', BROKEN)).toBe(BROKEN);
    const ok = `model X {\n  createdAt DateTime @default(now())\n}`;
    expect(fixPrismaDateStringDefault('prisma/schema.prisma', ok)).toBe(ok);
  });

  it('runs through applyFullStackGuards (wired, flag-gated)', () => {
    expect(applyFullStackGuards('prisma/schema.prisma', BROKEN)).toContain('createdAt DateTime');
    expect(applyFullStackGuards('prisma/schema.prisma', BROKEN, { AGENTV3_FULLSTACK_GUARDS: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(BROKEN);
  });
});

describe('applyFullStackGuards — orchestration + kill switch', () => {
  it('applies both guards through one call', () => {
    const out = applyFullStackGuards('prisma/schema.prisma', SQLITE_SCHEMA);
    expect(out).not.toContain('enum TaskStatus');
  });

  it('AGENTV3_FULLSTACK_GUARDS=off is a pure pass-through', () => {
    expect(fullStackGuardsEnabled({ AGENTV3_FULLSTACK_GUARDS: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    const out = applyFullStackGuards('prisma/schema.prisma', SQLITE_SCHEMA, { AGENTV3_FULLSTACK_GUARDS: 'off' } as unknown as NodeJS.ProcessEnv);
    expect(out).toBe(SQLITE_SCHEMA);
  });

  it('default (unset) is ON', () => {
    expect(fullStackGuardsEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

// ShopKhata autopsy 2026-07-17: the dev server NEVER booted — root vite.config.ts crashed with
// "vite-tsconfig-paths resolved to an ESM file. ESM file cannot be loaded by `require`" because the
// workspace package.json had no "type": "module". The guard re-inserts the invariant on every vite
// package.json write, so a builder rewrite can never kill config loading again.
describe('fixPrismaSeedRunner — seed runs on tsx, not ts-node (LedgerLoop autopsy)', () => {
  it('rewrites a ts-node seed script to tsx and adds tsx to devDependencies', () => {
    const pkg = JSON.stringify({ name: 'app', scripts: { seed: 'ts-node prisma/seed.ts' }, devDependencies: { 'ts-node': '^10' } });
    const out = JSON.parse(fixPrismaSeedRunner('package.json', pkg));
    expect(out.scripts.seed).toBe('tsx prisma/seed.ts');
    expect(out.devDependencies.tsx).toBe('^4');
  });

  it('rewrites the prisma.seed command form too (node --loader ts-node/esm)', () => {
    const pkg = JSON.stringify({ name: 'app', prisma: { seed: 'node --loader ts-node/esm prisma/seed.ts' } });
    const out = JSON.parse(fixPrismaSeedRunner('package.json', pkg));
    expect(out.prisma.seed).toBe('tsx prisma/seed.ts');
    expect(out.devDependencies.tsx).toBe('^4');
  });

  it('leaves a seed already on tsx (or absent) untouched', () => {
    const onTsx = JSON.stringify({ name: 'app', scripts: { seed: 'tsx prisma/seed.ts' } });
    expect(fixPrismaSeedRunner('package.json', onTsx)).toBe(onTsx);
    const none = JSON.stringify({ name: 'app', scripts: { dev: 'next dev' } });
    expect(fixPrismaSeedRunner('package.json', none)).toBe(none);
  });

  it('runs through applyFullStackGuards (wired, flag-gated)', () => {
    const pkg = JSON.stringify({ name: 'app', scripts: { seed: 'ts-node prisma/seed.ts' } });
    expect(JSON.parse(applyFullStackGuards('package.json', pkg)).scripts.seed).toBe('tsx prisma/seed.ts');
    expect(applyFullStackGuards('package.json', pkg, { AGENTV3_FULLSTACK_GUARDS: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(pkg);
  });
});

describe('ensureViteTypeModule — a vite package.json always carries type:module', () => {
  it('adds type:module to a vite app package.json that lacks it (the ShopKhata wall)', () => {
    const pkg = JSON.stringify({ name: 'project', version: '0.1.0', scripts: { dev: 'vite' }, devDependencies: { vite: '^5.4.1', 'vite-tsconfig-paths': '5.1.4' } });
    const out = JSON.parse(ensureViteTypeModule('package.json', pkg));
    expect(out.type).toBe('module');
    expect(out.devDependencies.vite).toBe('^5.4.1'); // everything else preserved
  });

  it('never touches a backend (non-vite) package.json', () => {
    const backend = JSON.stringify({ name: 'backend', scripts: { dev: 'nodemon src/index.js' }, dependencies: { express: '^4.19.0' } });
    expect(ensureViteTypeModule('backend/package.json', backend)).toBe(backend);
  });

  it('respects an explicit "type" — commonjs stays commonjs, module stays byte-for-byte', () => {
    const cjs = JSON.stringify({ name: 'p', type: 'commonjs', devDependencies: { vite: '^5' } });
    expect(ensureViteTypeModule('package.json', cjs)).toBe(cjs);
    const esm = JSON.stringify({ name: 'p', type: 'module', devDependencies: { vite: '^5' } });
    expect(ensureViteTypeModule('package.json', esm)).toBe(esm);
  });

  it('detects vite via the dev script alone (deps object absent)', () => {
    const out = JSON.parse(ensureViteTypeModule('frontend/package.json', JSON.stringify({ name: 'f', scripts: { dev: 'vite --port 5173' } })));
    expect(out.type).toBe('module');
  });

  it('leaves invalid JSON and non-package.json paths untouched', () => {
    expect(ensureViteTypeModule('package.json', '{ broken')).toBe('{ broken');
    expect(ensureViteTypeModule('src/App.tsx', 'not json')).toBe('not json');
  });

  it('runs through applyFullStackGuards (wired, flag-gated)', () => {
    const pkg = JSON.stringify({ name: 'p', scripts: { dev: 'vite' } });
    expect(JSON.parse(applyFullStackGuards('package.json', pkg)).type).toBe('module');
    expect(applyFullStackGuards('package.json', pkg, { AGENTV3_FULLSTACK_GUARDS: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(pkg);
  });
});
