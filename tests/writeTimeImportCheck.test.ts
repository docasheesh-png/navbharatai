/**
 * Catching a broken import while the agent is still on the file.
 *
 * ADMIN REPORT 2026-08-11 — a user's Android build died on `src/components/Login.test.tsx`:
 * "Module './Login' has no exported member". Detection and a deterministic fixer both already existed;
 * both ran at the END of the build, by which point (per ImportExportReconcile's own header) "the
 * agent's intent was elsewhere and these files are never revisited".
 *
 * The two things that must stay true are opposites, and both are tested: it must CATCH the reported
 * failure, and it must stay SILENT on correct code. A guard that cries wolf sends the agent to rewrite
 * code that was already right — worse than saying nothing, and it spends the user's money doing it.
 */

import { describe, it, expect } from 'vitest';
import {
  importCheckNote,
  shouldCheckImports,
  relativeSpecifiers,
  candidatePaths,
} from '../src/server/AgentV3/writeTimeImportCheck';

/** A workspace as a plain map; anything absent rejects, exactly like the real actuator. */
const deps = (files: Record<string, string>) => ({
  readFile: async (p: string) => {
    if (files[p] === undefined) throw new Error(`no such file: ${p}`);
    return files[p];
  },
});

const LOGIN_DEFAULT = 'export default function Login() { return null; }\n';

describe('🔒 it catches the reported failure', () => {
  it('names the missing export, the line, and both ways out', async () => {
    const note = await importCheckNote(
      'src/components/Login.test.tsx',
      "import { LoginForm } from './Login';\n\ntest('renders', () => {});\n",
      deps({ 'src/components/Login.tsx': LOGIN_DEFAULT }),
    );
    expect(note).toContain('BROKEN IMPORT');
    expect(note).toContain('LoginForm');
    expect(note).toContain('./Login');
    // Both remedies, because either can be the right one and the agent knows which.
    expect(note).toMatch(/Import a name it really exports, or export/);
  });

  it('says WHY it matters, since the whole point is that tsc reads tests', async () => {
    const note = await importCheckNote(
      'src/components/Login.test.tsx',
      "import { Nope } from './Login';\n",
      deps({ 'src/components/Login.tsx': LOGIN_DEFAULT }),
    );
    expect(note).toContain('tsc');
    expect(note).toContain('Fix it now, while you are on this file');
  });

  it('catches a default import from a module that has no default', async () => {
    const note = await importCheckNote(
      'src/lib/util.test.ts',
      "import util from './util';\n",
      deps({ 'src/lib/util.ts': 'export const helper = 1;\n' }),
    );
    expect(note).toContain('no default export');
  });
});

describe('🔒 it stays silent on correct code', () => {
  it('a correct default import produces nothing', async () => {
    const note = await importCheckNote(
      'src/components/Login.test.tsx',
      "import Login from './Login';\n",
      deps({ 'src/components/Login.tsx': LOGIN_DEFAULT }),
    );
    expect(note).toBe('');
  });

  it('🔒 an `export { … }` list is understood — the regex trap that would have caused false alarms', async () => {
    // The workspace memory's export regex only sees `export function/const/…`, so checking against it
    // would report this correct file as broken and send the agent to "fix" working code.
    const note = await importCheckNote(
      'src/components/Login.test.tsx',
      "import { LoginForm } from './Login';\n",
      deps({ 'src/components/Login.tsx': 'function LoginForm() { return null; }\nexport { LoginForm };\n' }),
    );
    expect(note).toBe('');
  });

  it('a barrel re-export resolves', async () => {
    const note = await importCheckNote(
      'src/components/Login.test.tsx',
      "import { LoginForm } from './index';\n",
      deps({
        'src/components/index.ts': "export { LoginForm } from './Login';\n",
        'src/components/Login.tsx': 'export function LoginForm() { return null; }\n',
      }),
    );
    expect(note).toBe('');
  });

  it('🔒 a module that does not exist YET is not reported — that is normal mid-build', async () => {
    // Half-written projects import files the agent is about to create. Complaining here would fire on
    // almost every build and the note would be learned as noise.
    const note = await importCheckNote(
      'src/components/Login.test.tsx',
      "import { LoginForm } from './NotWrittenYet';\n",
      deps({}),
    );
    expect(note).toBe('');
  });

  it('package imports are none of its business', async () => {
    expect(relativeSpecifiers("import React from 'react';\nimport { render } from '@testing-library/react';")).toEqual([]);
  });
});

describe('scope and cost', () => {
  it('🔒 only test files are checked', () => {
    for (const f of ['a.test.ts', 'a.test.tsx', 'a.spec.js', 'src/x/y.test.tsx']) {
      expect(shouldCheckImports(f), f).toBe(true);
    }
    for (const f of ['src/App.tsx', 'src/lib/util.ts', 'README.md', 'src/testUtils.ts']) {
      expect(shouldCheckImports(f), f).toBe(false);
    }
  });

  it('a non-test file produces no note even with a broken import', async () => {
    const note = await importCheckNote(
      'src/App.tsx',
      "import { Missing } from './Login';\n",
      deps({ 'src/Login.tsx': LOGIN_DEFAULT }),
    );
    expect(note).toBe('');
  });

  it('skips a file importing an unreasonable number of modules rather than reading them all', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `import { X${i} } from './m${i}';`).join('\n');
    expect(await importCheckNote('a.test.ts', many, deps({}))).toBe('');
  });

  it('resolves the way a bundler would — extensions and index files', () => {
    const c = candidatePaths('src/components/Login.test.tsx', './Login');
    expect(c).toContain('src/components/Login.tsx');
    expect(c).toContain('src/components/Login/index.ts');
    expect(candidatePaths('src/a/b.test.ts', '../shared/x')).toContain('src/shared/x.ts');
  });
});

describe('🔒 it can never break a write', () => {
  it('a reader that throws yields no note instead of an error', async () => {
    const note = await importCheckNote('a.test.ts', "import { X } from './x';", {
      readFile: async () => { throw new Error('sandbox gone'); },
    });
    expect(note).toBe('');
  });

  it('junk input is survivable', async () => {
    expect(await importCheckNote('a.test.ts', undefined as never, deps({}))).toBe('');
    expect(await importCheckNote('a.test.ts', '', deps({}))).toBe('');
  });
});
