import { describe, it, expect } from 'vitest';
import { analyzeHeavyImports, heavyImportSummary } from './heavyImportAnalysis';

const f = (path: string, content: string) => ({ path, content });

describe('analyzeHeavyImports', () => {
  it('flags a moment import and suggests a lighter alternative', () => {
    const issues = analyzeHeavyImports([f('src/App.tsx', "import moment from 'moment';\nmoment();")]);
    const m = issues.find((i) => i.package === 'moment');
    expect(m).toBeTruthy();
    expect(m!.kind).toBe('heavy-dependency');
    expect(m!.detail).toContain('dayjs');
  });

  it('flags a whole-library default import of lodash (both heavy-dependency AND whole-library)', () => {
    const issues = analyzeHeavyImports([f('src/util.ts', "import _ from 'lodash';\n_.debounce(() => {}, 100);")]);
    expect(issues.some((i) => i.package === 'lodash' && i.kind === 'heavy-dependency')).toBe(true);
    expect(issues.some((i) => i.package === 'lodash' && i.kind === 'whole-library-import')).toBe(true);
  });

  it('flags a namespace import of react-icons', () => {
    const issues = analyzeHeavyImports([f('src/Icons.tsx', "import * as Icons from 'react-icons';")]);
    const i = issues.find((x) => x.package === 'react-icons');
    expect(i?.kind).toBe('whole-library-import');
    expect(i?.detail).toContain('react-icons/fa');
  });

  it('does NOT flag a deep/per-method import (already tree-shaken)', () => {
    const issues = analyzeHeavyImports([
      f('a.ts', "import debounce from 'lodash/debounce';"),
      f('b.tsx', "import { FaHome } from 'react-icons/fa';"),
    ]);
    expect(issues.some((i) => i.kind === 'whole-library-import')).toBe(false);
  });

  it('does NOT flag a NAMED-only import of a tree-shakeable package (react-bootstrap)', () => {
    const issues = analyzeHeavyImports([f('c.tsx', "import { Button, Modal } from 'react-bootstrap';")]);
    expect(issues).toEqual([]);
  });

  it('does NOT flag ordinary local or light imports', () => {
    const issues = analyzeHeavyImports([
      f('d.tsx', "import React from 'react';\nimport { thing } from './local';\nimport clsx from 'clsx';"),
    ]);
    expect(issues).toEqual([]);
  });

  it('skips test/spec and .d.ts files', () => {
    expect(analyzeHeavyImports([
      f('x.test.tsx', "import moment from 'moment';"),
      f('y.d.ts', "import moment from 'moment';"),
    ])).toEqual([]);
  });

  it('dedupes across files (one issue per package+kind) and tolerates malformed input', () => {
    const issues = analyzeHeavyImports([
      f('a.tsx', "import moment from 'moment';"),
      f('b.tsx', "import moment from 'moment';"),
      // @ts-expect-error malformed
      null,
    ]);
    expect(issues.filter((i) => i.package === 'moment' && i.kind === 'heavy-dependency')).toHaveLength(1);
  });
});

describe('heavyImportSummary', () => {
  it('reports the clean line when nothing is heavy', () => {
    expect(heavyImportSummary([])).toContain('No known-heavy imports');
  });

  it('lists the heavy imports', () => {
    const out = heavyImportSummary(analyzeHeavyImports([f('a.tsx', "import moment from 'moment';")]));
    expect(out).toContain('heavy import(s)');
    expect(out).toContain('moment');
  });
});
