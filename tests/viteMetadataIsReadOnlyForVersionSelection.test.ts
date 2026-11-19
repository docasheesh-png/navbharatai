import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyWellKnownMissingDeps, installSelectsVitestVersion, needsViteDependencyMetadata,
} from '../src/server/AgentV3/DependencyAutoFix';
import { needsVitestVersionSelection } from '../src/server/AgentV3/TestGenerationAgent';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

const metadataPaths = ['node_modules/vite/package.json', 'package-lock.json'];
const angular = '{"devDependencies":{"@angular/build":"^19"}}';
const inputs = { path: 'src/app/models.test.ts', module_path: './models', functions: [{ name: 'payoutFor' }] };

describe('remote Vite metadata is demanded only by an automatic version selection', () => {
  it.each(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
    ('an explicitly declared runner in %s needs no version selection', (section) => {
      expect(needsVitestVersionSelection(JSON.stringify({ [section]: { vitest: '^3.2.4' } }))).toBe(false);
    });

  it.each([undefined, null, '{bad', 'null', '[]'])('an unreadable/invalid manifest %s is not a metadata demand', (pkg) => {
    expect(needsVitestVersionSelection(pkg)).toBe(false);
    expect(needsViteDependencyMetadata(pkg, ['vitest'])).toBe(false);
  });

  it.each(['vitest', '@vitest/ui', '@vitest/coverage-v8'])('a new %s needs transitive metadata when Vite is absent', (name) => {
    expect(needsViteDependencyMetadata(angular, [name])).toBe(true);
  });

  it('a direct Vite declaration is authoritative, even when its range is unsupported', () => {
    for (const vite of ['^5.4', '^8', '^9', 'latest']) {
      expect(needsViteDependencyMetadata(JSON.stringify({ devDependencies: { vite } }), ['vitest'])).toBe(false);
    }
  });

  it('an existing snapshot resolution does not trigger a redundant remote read', () => {
    expect(needsViteDependencyMetadata(angular, ['vitest'], {
      packageLockJson: '{"packages":{"node_modules/vite":{"version":"6.2.0"}}}',
    })).toBe(false);
    expect(needsViteDependencyMetadata(angular, ['vitest'], {
      installedVitePackageJson: '{"name":"vite","version":"6.2.0"}',
    })).toBe(false);
    expect(needsViteDependencyMetadata(angular, ['vitest'], { packageLockJson: '{bad' })).toBe(true);
  });

  it('a no-op or unrelated dependency choice has no Vite metadata demand', () => {
    expect(needsViteDependencyMetadata(angular, [])).toBe(false);
    expect(needsViteDependencyMetadata(angular, ['axios', '@react-three/fiber', '@capacitor/haptics'])).toBe(false);
  });
});

describe('command demand follows the existing install parser', () => {
  it.each<[string, boolean]>([
    ['npm i -D vitest', true], ['pnpm add @vitest/ui', true], ['yarn add @vitest/coverage-v8', true],
    ['npm uninstall vitest', false], ['npm test -- vitest', false], ['npx vitest run', false],
    ['npm install vitest@3.2.4', false], ['npm i @vitest/ui@^3', false],
    ['npm install @react-three/fiber', false], ['npm install @capacitor/haptics', false],
    ['npm ci', false], ['echo vitest', false],
    ['npm uninstall vitest && npm i -D vitest', true],
  ])('%s selects a version: %s', (command, expected) => {
    expect(installSelectsVitestVersion(command)).toBe(expected);
  });
});

describe('reconciliation demand comes from its actual planned additions', () => {
  it.each<[string, boolean]>([
    ['export const n = 1;', false],
    ["import axios from 'axios';", false],
    ["import { it } from 'vitest';", true],
  ])('inspects only a new runner selection from %s', (source, expected) => {
    const result = applyWellKnownMissingDeps({ 'package.json': angular, 'src/test.ts': source });
    expect(needsViteDependencyMetadata(angular, result.added.map((dep) => dep.package))).toBe(expected);
  });

  it('an existing runner and an unrelated missing import do not cause metadata reads', () => {
    const pkg = '{"devDependencies":{"vitest":"^3.2.4"}}';
    const result = applyWellKnownMissingDeps({ 'package.json': pkg, 'src/test.ts': "import { it } from 'vitest'; import axios from 'axios';" });
    expect(result.added.map((dep) => dep.package)).toEqual(['axios']);
    expect(needsViteDependencyMetadata(pkg, result.added.map((dep) => dep.package))).toBe(false);
  });
});

describe('the real generation tools preserve no-op and script-only fast paths', () => {
  it.each(['generate_tests', 'generate_money_format'])('%s preserves an explicit runner without touching metadata', async (tool) => {
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const script of [undefined, 'vitest run --coverage']) {
        const { act, d } = makeDispatcher();
        act.files.set('package.json', JSON.stringify({ [section]: { vitest: '^3.2.4' }, ...(script ? { scripts: { test: script } } : {}) }));
        const reads = vi.spyOn(act, 'readFile');
        const result = await d.dispatch(toolCall(tool, tool === 'generate_tests' ? inputs : {}), 'architect');
        expect(result.is_error).not.toBe(true);
        expect(reads.mock.calls.map(([, path]) => path).filter((path) => metadataPaths.includes(path))).toEqual([]);
        const pkg = JSON.parse(act.files.get('package.json')!);
        expect(pkg[section].vitest).toBe('^3.2.4');
        expect(pkg.scripts.test).toBe(script ?? 'vitest run');
      }
    }
  });

  it.each(['^5.4.0', '^8.0.0'])('a new runner for direct Vite%s needs no metadata read', async (vite) => {
    const { act, d } = makeDispatcher();
    act.files.set('package.json', JSON.stringify({ devDependencies: { vite } }));
    const reads = vi.spyOn(act, 'readFile');
    const result = await d.dispatch(toolCall('generate_tests', inputs), 'architect');
    expect(result.is_error).not.toBe(true);
    expect(reads.mock.calls.map(([, path]) => path).filter((path) => metadataPaths.includes(path))).toEqual([]);
    expect(JSON.parse(act.files.get('package.json')!).devDependencies.vitest).toMatch(vite.startsWith('^5') ? /^\^3/ : /^\^5/);
  });

  it('a new Angular runner still reads transitive Vite and selects its compatible version', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('package.json', angular);
    act.files.set('node_modules/vite/package.json', '{"name":"vite","version":"6.2.0"}');
    const reads = vi.spyOn(act, 'readFile');
    const result = await d.dispatch(toolCall('generate_tests', inputs), 'architect');
    expect(result.is_error).not.toBe(true);
    expect(reads.mock.calls.map(([, path]) => path).filter((path) => metadataPaths.includes(path)).sort()).toEqual([...metadataPaths].sort());
    expect(JSON.parse(act.files.get('package.json')!).devDependencies.vitest).toBe('^3');
  });
});

describe('all four metadata callers pass through the demand boundary', () => {
  it('no zero-argument eager call survives, and command/reconcile paths derive demand from their existing logic', () => {
    const source = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(source).not.toContain('this.viteDependencyMetadata()');
    expect(source).toContain('if (!needsViteDependencyMetadata(packageJson, automaticPackages, knownMetadata)) return {};');
    expect(source).toContain("installSelectsVitestVersion(command) ? ['vitest'] : []");
    expect(source).toContain('depRes.added.map((dep) => dep.package)');
    expect(source.match(/needsVitestVersionSelection\((before|pkgBefore)\)/g)).toHaveLength(2);
  });
});
