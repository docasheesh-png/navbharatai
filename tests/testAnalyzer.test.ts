import { describe, it, expect } from 'vitest';
import { analyzeForTests, selectTopTargets, testPathFor } from '../src/server/pro/TestAnalyzer';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

function makeVfs(files: Record<string, string>): VirtualFileSystem {
  return VirtualFileSystem.fromRecord(files);
}

describe('testPathFor', () => {
  it('appends .test before the extension', () => {
    expect(testPathFor('src/App.tsx')).toBe('src/App.test.tsx');
    expect(testPathFor('src/hooks/useAuth.ts')).toBe('src/hooks/useAuth.test.ts');
    expect(testPathFor('src/utils/format.js')).toBe('src/utils/format.test.js');
  });
});

describe('analyzeForTests', () => {
  it('returns empty array for VFS with no testable source files', () => {
    const vfs = makeVfs({ 'styles.css': '.btn { color: red; }' });
    expect(analyzeForTests(vfs)).toHaveLength(0);
  });

  it('identifies a React component as category component', () => {
    const vfs = makeVfs({
      'src/App.tsx': `
        import React from 'react';
        export default function App() { return (<div>Hello</div>); }
      `,
    });
    const targets = analyzeForTests(vfs);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0].category).toBe('component');
    expect(targets[0].sourcePath).toBe('src/App.tsx');
    expect(targets[0].testPath).toBe('src/App.test.tsx');
  });

  it('identifies a custom hook as category hook', () => {
    const vfs = makeVfs({
      'src/hooks/useCounter.ts': `
        import { useState } from 'react';
        export function useCounter() { const [n, setN] = useState(0); return { n, inc: () => setN(n+1) }; }
      `,
    });
    const targets = analyzeForTests(vfs);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0].category).toBe('hook');
  });

  it('identifies a utility file as category util', () => {
    const vfs = makeVfs({
      'src/utils/format.ts': `
        export function formatCurrency(amount: number): string { return '$' + amount.toFixed(2); }
        export function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
      `,
    });
    const targets = analyzeForTests(vfs);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0].category).toBe('util');
  });

  it('skips existing test files', () => {
    const vfs = makeVfs({
      'src/App.tsx': `export default function App() { return (<div>Hi</div>); }`,
      'src/App.test.tsx': `import { describe, it } from 'vitest'; it('works', () => {});`,
    });
    const targets = analyzeForTests(vfs);
    const paths = targets.map((t) => t.sourcePath);
    expect(paths).not.toContain('src/App.test.tsx');
  });

  it('skips CSS, JSON, and config files', () => {
    const vfs = makeVfs({
      'src/styles.css': '.btn { color: blue; }',
      'package.json': '{"name":"test"}',
      'vite.config.ts': 'export default {}',
      'src/utils/format.ts': 'export function noop() {}',
    });
    const targets = analyzeForTests(vfs);
    const paths = targets.map((t) => t.sourcePath);
    expect(paths).not.toContain('src/styles.css');
    expect(paths).not.toContain('package.json');
    expect(paths).not.toContain('vite.config.ts');
  });

  it('gives App.tsx higher priority than a generic page component', () => {
    const componentBoilerplate = `import React from 'react';\nexport default function Comp({ title }: { title: string }) {\n  return (<div className="wrapper"><h1>{title}</h1><p>Content goes here.</p></div>);\n}\n`;
    const vfs = makeVfs({
      'src/App.tsx': componentBoilerplate.replace('Comp', 'App'),
      'src/pages/About.tsx': componentBoilerplate.replace('Comp', 'About'),
    });
    const targets = analyzeForTests(vfs);
    const appTarget = targets.find((t) => t.sourcePath === 'src/App.tsx');
    const aboutTarget = targets.find((t) => t.sourcePath === 'src/pages/About.tsx');
    expect(appTarget).toBeDefined();
    expect(aboutTarget).toBeDefined();
    expect(appTarget!.priority).toBeGreaterThan(aboutTarget!.priority);
  });
});

describe('selectTopTargets', () => {
  it('returns all targets when count <= maxFiles', () => {
    const vfs = makeVfs({
      'src/App.tsx': `export default function App() { return (<div>App</div>); }`,
      'src/utils/format.ts': `export function noop() { return 1; }`,
    });
    const targets = analyzeForTests(vfs);
    const selected = selectTopTargets(targets, 4);
    expect(selected.length).toBe(targets.length);
  });

  it('caps results at maxFiles', () => {
    const files: Record<string, string> = {};
    const boilerplate = `import React from 'react';\nexport default function Comp() {\n  return (<div className="box"><h1>Title</h1><p>Content</p></div>);\n}\n`;
    for (let i = 0; i < 10; i++) {
      files[`src/comp${i}.tsx`] = boilerplate.replace('Comp', `Comp${i}`);
    }
    const vfs = makeVfs(files);
    const targets = analyzeForTests(vfs);
    const selected = selectTopTargets(targets, 3);
    expect(selected.length).toBe(3);
  });

  it('returns highest priority targets first', () => {
    const vfs = makeVfs({
      'src/App.tsx': `import React from 'react';\nexport default function App() { return (<div className="app"><h1>Hello</h1></div>); }\n`,
      'src/hooks/useAuth.ts': `import { useState } from 'react';\nexport function useAuth() {\n  const [user, setUser] = useState<string | null>(null);\n  const login = (u: string) => setUser(u);\n  const logout = () => setUser(null);\n  return { user, login, logout };\n}\n`,
      'src/utils/format.ts': `export function formatCurrency(n: number): string { return '$' + n.toFixed(2); }\nexport function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }\n`,
    });
    const targets = analyzeForTests(vfs);
    const selected = selectTopTargets(targets, 2);
    // hook priority > component priority > util priority
    const categories = selected.map((t) => t.category);
    expect(categories[0]).toBe('hook');
  });
});
