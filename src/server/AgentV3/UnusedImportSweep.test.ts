import { describe, it, expect } from 'vitest';
import { stripUnusedNamedImports, sweepUnusedImports, importSweepEnabled } from './UnusedImportSweep';

// First-build-correct (prevent-not-heal): the engine burned whole "fix the error" rounds removing its OWN
// unused named imports. This sweep removes only PROVABLY-dead named specifiers, keep-on-any-doubt, so a used
// import can never be removed. The real report cases: Suspense, useAuth, useEffect, `User` from lucide-react.

describe('stripUnusedNamedImports — removes provably-dead named specifiers (the real report cases)', () => {
  it('drops an unused named specifier but keeps the used ones', () => {
    const src = `import { useState, Suspense } from 'react';\nexport default function A(){ const [x] = useState(0); return <div>{x}</div>; }`;
    const out = stripUnusedNamedImports('src/App.tsx', src);
    expect(out).toContain("import { useState } from 'react';");
    expect(out).not.toContain('Suspense');
  });

  it('drops the WHOLE statement when every named specifier is unused (pure named import)', () => {
    const src = `import { useAuth } from '../contexts/AuthContext';\nexport const Header = () => <header>hi</header>;`;
    const out = stripUnusedNamedImports('src/components/layout/Header.tsx', src);
    expect(out).not.toContain('useAuth');
    expect(out).not.toContain("from '../contexts/AuthContext'");
  });

  it('keeps a default import but drops the dead named part (`import Def, { dead }`)', () => {
    const src = `import React, { useEffect } from 'react';\nexport default class C extends React.Component { render(){ return null; } }`;
    const out = stripUnusedNamedImports('src/C.tsx', src);
    expect(out).toContain('import React from '); // default kept (React IS used)
    expect(out).not.toContain('useEffect');
  });

  it('drops an unused icon import (User from lucide-react) while keeping the used one', () => {
    const src = `import { User, LogOut } from 'lucide-react';\nexport const Nav = () => <button><LogOut/></button>;`;
    const out = stripUnusedNamedImports('src/pages/LoginPage.tsx', src);
    expect(out).toContain('LogOut');
    expect(out).not.toMatch(/\bUser\b/);
  });

  it('respects an alias — removes by the LOCAL name', () => {
    const used = `import { foo as bar } from 'x';\nconsole.log(bar);`;
    expect(stripUnusedNamedImports('a.ts', used)).toContain('foo as bar'); // bar used → kept
    const dead = `import { foo as bar } from 'x';\nconsole.log(foo);`; // only the ORIGINAL name appears → bar is dead
    expect(stripUnusedNamedImports('a.ts', dead)).not.toContain('foo as bar');
  });
});

describe('stripUnusedNamedImports — SAFE: never removes a used or ambiguous import', () => {
  it('NEVER touches a side-effect import', () => {
    const src = `import './styles.css';\nimport 'reflect-metadata';\nexport const x = 1;`;
    expect(stripUnusedNamedImports('src/main.ts', src)).toBe(src);
  });

  it('NEVER touches a namespace import (may be used dynamically)', () => {
    const src = `import * as utils from './utils';\nexport const x = 1;`; // utils not referenced, but * as is never stripped
    expect(stripUnusedNamedImports('src/main.ts', src)).toBe(src);
  });

  it('keeps a specifier used only inside JSX', () => {
    const src = `import { Card } from './ui';\nexport default () => <Card>hi</Card>;`;
    expect(stripUnusedNamedImports('src/App.tsx', src)).toContain('Card');
  });

  it('keeps a type-only import used only in a type position', () => {
    const src = `import type { User } from './types';\nexport function f(u: User){ return u.id; }`;
    expect(stripUnusedNamedImports('src/f.ts', src)).toContain('User');
  });

  it('keeps everything when all specifiers are used', () => {
    const src = `import { a, b } from 'x';\nconsole.log(a, b);`;
    expect(stripUnusedNamedImports('a.ts', src)).toBe(src);
  });

  it('is a no-op for non-source files and files with no imports', () => {
    expect(stripUnusedNamedImports('README.md', 'import { x } from "y"')).toBe('import { x } from "y"');
    expect(stripUnusedNamedImports('a.d.ts', `import { X } from 'y';`)).toBe(`import { X } from 'y';`);
    expect(stripUnusedNamedImports('a.ts', 'export const x = 1;')).toBe('export const x = 1;');
  });
});

describe('sweepUnusedImports + flag', () => {
  it('returns only the files that changed', () => {
    const changed = sweepUnusedImports({
      'src/App.tsx': `import { useState, Suspense } from 'react';\nconst A = () => { useState(); };`,
      'src/clean.ts': `import { a } from 'x';\nconsole.log(a);`,
      'README.md': 'import nothing real',
    });
    expect(Object.keys(changed)).toEqual(['src/App.tsx']);
    expect(changed['src/App.tsx']).not.toContain('Suspense');
  });

  it('flag defaults ON, off disables', () => {
    expect(importSweepEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(importSweepEnabled({ AGENTV3_IMPORT_SWEEP: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

/**
 * `import type { … }` MUST NOT BE CORRUPTED INTO `import type, { … }` (admin audit 2026-08-12).
 *
 * A post-build audit found this pass — which runs on every build, rewrites source, and persists
 * durably — turning `import type { Props, Unused }` into `import type, { Props }`, a syntax error, in
 * a WORKING app. The `type` keyword is a type-only MODIFIER on the whole import, not a default binding.
 * `import type {` appears in 390 files in this repo alone, and findSyntaxErrors parses the broken output
 * fine, so nothing downstream catches it.
 */
describe('the import-type modifier is a modifier, not a default binding', () => {
  it('drops the unused specifier and KEEPS the type modifier — no `type,` corruption', () => {
    const out = stripUnusedNamedImports('src/x.ts', "import type { Props, Unused } from './types';\nexport const x = (p: Props) => p;\n");
    expect(out).toContain('import type { Props } from');
    expect(out).not.toContain('import type,');
  });

  it('drops the whole statement when every type specifier is unused', () => {
    const out = stripUnusedNamedImports('src/x.ts', "import type { Unused } from './types';\nexport const y = 1;\n");
    expect(out).not.toContain('import');
    expect(out).toContain('export const y = 1;');
  });

  it('leaves a fully-used type import untouched', () => {
    const src = "import type { Props, State } from './types';\nexport const z = (p: Props, s: State) => 0;\n";
    expect(stripUnusedNamedImports('src/x.ts', src)).toContain('import type { Props, State } from');
  });

  it('inline `import { type A, type B }` modifiers still work', () => {
    const out = stripUnusedNamedImports('src/x.ts', "import { type Props, type Unused } from './t';\nexport const a = (p: Props) => p;\n");
    expect(out).toContain('import { type Props } from');
  });

  it('a genuine default binding is still preserved — the fix did not break that path', () => {
    const out = stripUnusedNamedImports('src/x.ts', "import Def, { Used, Dead } from './m';\nexport const b = () => Def(Used);\n");
    expect(out).toContain('import Def, { Used } from');
  });
})
