import { describe, it, expect } from 'vitest';
import {
  stripPrismaSqliteEnums,
  fixCjsDefaultImport,
  applyFullStackGuards,
  fullStackGuardsEnabled,
} from './FullStackGuards';

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
