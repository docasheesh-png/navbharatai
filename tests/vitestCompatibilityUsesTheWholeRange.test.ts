import { describe, expect, it } from 'vitest';
import {
  applyWellKnownMissingDeps, knownDepVersion, pinKnownDepsInInstallCommand, planDependencyAutoFix,
  viteRangeOf, vitestRangeForVite,
} from '../src/server/AgentV3/DependencyAutoFix';
import { generatedVitestRange, starterTestsNarration, vitestDeclarationNote, withVitestDeclared } from '../src/server/AgentV3/TestGenerationAgent';

// Registry evidence captured in autopsy-cdff-session/test-tooling/vitest-registry-compatibility.json.
// Vitest5 needs Vite6.4+, not every6.x; Vitest3 needs Vite5+, not every older major.
describe('a Vitest family must support the whole Vite range', () => {
  it.each([
    ['6.0.0', '^3'], ['6.1.9', '^3'], ['6.2.0', '^3'], ['6.3.9', '^3'],
    ['^6.0.0', '^3'], ['~6.3.0', '^3'], ['6.x', '^3'], ['>=5 <7', '^3'],
    ['6.4.0', '^5'], ['^6.4.0', '^5'], ['~6.4', '^5'], ['7', '^5'], ['8', '^5'],
    ['>=6.4.0 <9', '^5'], ['^6.4.0 || ^8.0.0', '^5'],
    ['4.0.0', '^0.34.6'], ['4.5.14', '^0.34.6'], ['^4', '^0.34.6'], ['~4.5.0', '^0.34.6'],
    ['3.1.0', '^0.34.6'], ['^3.1', '^0.34.6'], ['^4 || ^5', '^0.34.6'],
    ['^5 || ^7', '^3.2.0'], ['>=5 <8', '^3.2.0'], ['7.0.0-beta.1', '^3.2.0'],
  ])('%s selects the verified compatible family %s', (vite, expected) => {
    expect(vitestRangeForVite(vite)).toBe(expected);
  });

  it.each(['^2', '^3.0.0', '^9', '^4 || ^6', '^6.3 || ^8', '*', '>=6', 'latest', 'workspace:^8', '>9 <9'])
    ('does not invent a compatible pin for %s', (vite) => expect(vitestRangeForVite(vite)).toBe(''));

  it('an absent Vite context retains the current default', () => {
    expect(vitestRangeForVite(undefined)).toBe('^5');
    expect(vitestRangeForVite('')).toBe('^5');
  });

  it.each(['vitest', '@vitest/ui', '@vitest/coverage-v8'])('the whole runner family follows the same boundary: %s', (name) => {
    expect(knownDepVersion(name, { viteRange: '6.3.5' })).toBe('^3');
    expect(knownDepVersion(name, { viteRange: '4.5.14' })).toBe('^0.34.6');
    expect(knownDepVersion(name, { viteRange: '^9' })).toBe('');
  });
});

describe('installed/locked Vite resolution and all declaration paths share the precise selector', () => {
  const pkg = '{"devDependencies":{"@angular/build":"^19"}}';
  it.each([['6.3.5', '^3'], ['4.5.14', '^0.34.6']])('installed or locked Vite%s declares%s', (version, expected) => {
    const installed = { installedVitePackageJson: JSON.stringify({ name: 'vite', version }) };
    const locked = { packageLockJson: JSON.stringify({ packages: { 'node_modules/vite': { version } } }) };
    for (const metadata of [installed, locked]) {
      expect(generatedVitestRange(pkg, metadata)).toBe(expected);
      expect(JSON.parse(withVitestDeclared(pkg, metadata)!).devDependencies.vitest).toBe(expected);
    }
  });

  it('metadata must contain an actual version, not any string containing a digit', () => {
    expect(viteRangeOf(pkg, { installedVitePackageJson: '{"name":"vite","version":"version6.3"}' })).toBeUndefined();
    expect(viteRangeOf(pkg, { packageLockJson: '{"packages":{"node_modules/vite":{"version":"^6.3.0"}}}' })).toBeUndefined();
  });

  it('the install pinner and import reconciler select the same early-Vite6 family', () => {
    expect(pinKnownDepsInInstallCommand('npm i -D vitest @vitest/ui', { viteRange: '6.3.5' }))
      .toBe('npm i -D vitest@^3 @vitest/ui@^3');
    const files = { 'package.json': '{"devDependencies":{"vite":"~6.3.0"}}', 'test.ts': "import { it } from 'vitest';" };
    expect(JSON.parse(applyWellKnownMissingDeps(files).files['package.json']).devDependencies.vitest).toBe('^3');
  });

  it('an unsupported explicit range is reviewable without changing the manifest or deleting tests', () => {
    const before = '{"devDependencies":{"vite":"^9"}}';
    const files = { 'package.json': before, 'models.test.ts': "import { it } from 'vitest';" };
    expect(withVitestDeclared(before)).toBeNull();
    expect(applyWellKnownMissingDeps(files).files).toBe(files);
    expect(vitestDeclarationNote(before, null)).toContain('No compatible Vitest version');
    expect(vitestDeclarationNote(before, null)).toContain('Preserve the tests');
    expect(starterTestsNarration(['models.test.ts'], before)).not.toContain('npm install');
    expect(planDependencyAutoFix([{ kind: 'missing', package: 'vitest' } as never], { viteRange: '^9' }))
      .toEqual({ autofixable: [], needsReview: ['vitest'] });
  });

  it('unsupported transitive Vite metadata is explained with that same context', () => {
    const metadata = { installedVitePackageJson: '{"name":"vite","version":"9.0.0"}' };
    expect(withVitestDeclared(pkg, metadata)).toBeNull();
    expect(vitestDeclarationNote(pkg, null, metadata)).toContain('No compatible Vitest version');
  });

  it('an explicitly declared runner or explicitly versioned install stays the author’s choice', () => {
    const before = '{"devDependencies":{"vite":"^4","vitest":"^5"},"scripts":{"test":"vitest run --coverage"}}';
    expect(withVitestDeclared(before)).toBeNull();
    expect(vitestDeclarationNote(before, null)).toBe('');
    expect(pinKnownDepsInInstallCommand('npm i -D vitest@5.1.0', { viteRange: '4.5.14' })).toBe('npm i -D vitest@5.1.0');
  });
});
