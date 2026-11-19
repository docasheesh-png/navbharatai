import { describe, expect, it } from 'vitest';
import { scanAuthenticity } from '../src/server/AgentV3/AuthenticityAnalysis';
import { applyWellKnownMissingDeps, viteRangeOf } from '../src/server/AgentV3/DependencyAutoFix';
import {
  generatedUnitTestNote, generatedVitestRange, starterTestsNarration, VITEST_RANGE,
  vitestDeclarationNote, withVitestDeclared,
} from '../src/server/AgentV3/TestGenerationAgent';
import { generateUnitTest } from '../src/server/lib/TestSkeletonGenerator';

// cdffbb71: Angular 18's builder brought Vite 5.4.21 transitively. The generator imposed Vitest 5;
// its types then imported vite/module-runner, and the builder removed real tests to clear the error.
const angular = JSON.stringify({
  dependencies: { '@angular/core': '^18.0.0' },
  devDependencies: { '@angular-devkit/build-angular': '^18.0.0' },
});
const lock = JSON.stringify({ lockfileVersion: 3, packages: {
  '': JSON.parse(angular),
  'node_modules/@angular/build': { version: '18.2.21', dependencies: { vite: '~5.4.17' } },
  'node_modules/vite': { version: '5.4.21' },
} });
const stub = (source: string, path = 'src/app/wallet.component.ts') =>
  scanAuthenticity(path, source).filter((issue) => issue.kind === 'stub-marker');

describe('a form hint is an attribute, not unfinished code', () => {
  it.each([
    ['src/form.html', '<input type="number" placeholder="Enter amount">'],
    ['src/app/wallet.component.ts', 'template: `<input type="number" placeholder="Enter amount" [(ngModel)]="amount">`'],
    ['src/Form.tsx', '<input onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Enter amount" />'],
    ['src/Form.tsx', "<Input type='number' placeholder={'Enter amount'} />"],
    ['src/form.html', '<input\n  type="number" placeholder="Amount"\n>'],
    ['src/form.html', '<custom-widget name="amount" stub="an attribute value" />'],
  ])('%s preserves its real attribute', (path, source) => expect(stub(source, path)).toEqual([]));

  it.each([
    '// placeholder until the API is implemented',
    '/* stub = missing work */',
    'return "this is a stub";',
    'const text = "placeholder = missing behavior";',
    '<input title=" placeholder = missing behavior" />',
    '<input type="number" placeholder="Enter amount" /> // placeholder until implemented',
    '<input type="number" placeholder="stub value" />',
  ])('still flags a real marker: %s', (source) => expect(stub(source)).not.toEqual([]));

  it('retains source line numbers across multiline tags and huge skipped lines', () => {
    const source = 'x'.repeat(4001) + '\n<input\n type="number" placeholder="Amount">\n// stub';
    expect(stub(source).map((issue) => issue.line)).toEqual([4]);
  });
});

describe('generated runners follow actual project dependency metadata', () => {
  it('the reported Angular 18 lock resolves Vite 5 and gets the shared compatible Vitest family', () => {
    expect(viteRangeOf(angular, { packageLockJson: lock })).toBe('5.4.21');
    const after = JSON.parse(withVitestDeclared(angular, { packageLockJson: lock })!);
    expect(after.devDependencies.vitest).toBe('^3');
    expect(after.devDependencies['@angular-devkit/build-angular']).toBe('^18.0.0');
    expect(after.scripts.test).toBe('vitest run');
  });

  it('direct Vite 5 projects also use the compatibility selector', () => {
    expect(JSON.parse(withVitestDeclared('{"devDependencies":{"vite":"^5.4.0"}}')!).devDependencies.vitest).toBe('^3');
  });

  it('the import reconciler sibling uses lock metadata in its file snapshot', () => {
    const result = applyWellKnownMissingDeps({
      'package.json': angular, 'package-lock.json': lock,
      'src/app/models.test.ts': "import { describe } from 'vitest';",
    });
    expect(JSON.parse(result.files['package.json']).devDependencies.vitest).toBe('^3');
    expect(result.files['src/app/models.test.ts']).toBe("import { describe } from 'vitest';");
  });

  it('actual installed resolution takes precedence over stale lock metadata', () => {
    expect(generatedVitestRange(angular, {
      installedVitePackageJson: '{"name":"vite","version":"5.4.21"}',
      packageLockJson: '{"packages":{"node_modules/vite":{"version":"8.3.0"}}}',
    })).toBe('^3');
  });

  it('an explicit requested Vite upgrade takes precedence over the old install', () => {
    expect(generatedVitestRange('{"devDependencies":{"vite":"^8.3.0"}}', {
      installedVitePackageJson: '{"name":"vite","version":"5.4.21"}', packageLockJson: lock,
    })).toBe(VITEST_RANGE);
  });

  it('supports npm v1 locks, and tolerates absent or malformed installed metadata', () => {
    expect(generatedVitestRange(angular, {
      installedVitePackageJson: '{not json',
      packageLockJson: '{"lockfileVersion":1,"dependencies":{"vite":{"version":"5.4.21"}}}',
    })).toBe('^3');
    expect(generatedVitestRange(angular, { packageLockJson: '{bad' })).toBe(VITEST_RANGE);
  });

  it('does not infer root resolution from a framework name, nested copy or unrelated package', () => {
    expect(viteRangeOf(angular, {
      installedVitePackageJson: '{"name":"other","version":"5.0.0"}',
      packageLockJson: '{"packages":{"node_modules/other/node_modules/vite":{"version":"5.4.21"}}}',
    })).toBeUndefined();
    expect(viteRangeOf(angular)).toBeUndefined();
  });

  it('preserves an existing runner and the author’s command instead of deleting or downgrading them', () => {
    const owned = JSON.stringify({ devDependencies: { vitest: '^5' }, scripts: { test: 'vitest run --coverage' } });
    expect(withVitestDeclared(owned, { packageLockJson: lock })).toBeNull();
    expect(withVitestDeclared('{bad', { packageLockJson: lock })).toBeNull();
  });
});

describe('a generated skeleton or manifest edit is not behaviour verification', () => {
  it('narrates the actual compatible declaration without claiming it was installed or ran', () => {
    const after = withVitestDeclared(angular, { packageLockJson: lock });
    expect(vitestDeclarationNote(angular, after)).toContain('Declared vitest@^3');
    expect(vitestDeclarationNote(angular, after)).toContain('Dependencies must be synced');
    expect(vitestDeclarationNote(angular, after)).toContain('no test execution is proved');
  });

  it('script-only repair never claims to have added an existing runner', () => {
    const before = '{"devDependencies":{"vitest":"^3"}}';
    expect(vitestDeclarationNote(before, withVitestDeclared(before))).toMatch(/^added the test script\./);
    expect(vitestDeclarationNote(before, null)).toBe('');
    expect(vitestDeclarationNote(before, before)).toBe('');
    expect(vitestDeclarationNote(before, '{bad')).toBe('');
  });

  it('names/parameters produce explicitly pending cases, never invented expected values', () => {
    const content = generateUnitTest({ modulePath: './models', functions: [{ name: 'payoutFor', params: ['bet', 'result'] }] });
    expect(content).toContain("expect(typeof payoutFor).toBe('function')");
    expect(content).toContain("it.todo('payoutFor — assert real behaviour with real arguments')");
    expect(content).not.toContain('payoutFor(undefined');
    expect(generatedUnitTestNote('src/app/models.test.ts')).toContain('pending behavioural cases');
    expect(generatedUnitTestNote('src/app/models.test.ts')).toContain('Preserve those tests');
  });

  it('automatic starter narration distinguishes declared from installed/executed', () => {
    const note = starterTestsNarration(['src/app/models.test.ts'], withVitestDeclared(angular));
    expect(note).toContain('installation and execution are not verified');
    expect(note).toContain('behavioural cases remain pending');
    expect(note).not.toContain('runnable');
  });
});
