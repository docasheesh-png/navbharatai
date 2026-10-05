// A PACKAGE THE APP LOADS BUT NOBODY INSTALLED MAKES "READY" UNTRUE (Q-143, admin-approved (b) 2026-10-05).
//
// A missing npm package was advisory only, so a build could finish READY over an app whose first import
// throws "Cannot find module". Option (b): block only when the importing file is one the app loads and the
// package is still missing after the allowlist reconciler — and (verified at the call site) is not in an
// installed node_modules either.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadedMissingPackageUses, notInstalledBlockerLabel, undeclaredInstalledLabel } from '../src/server/AgentV3/missingPackageBlockers';
import type { ReachabilityVerdict } from '../src/server/AgentV3/appReachability';

const verdict = (reachable: string[]): ReachabilityVerdict =>
  ({ applicable: true, reason: 'test', roots: ['src/main.tsx'], reachable: new Set(reachable), unreachable: [] }) as ReachabilityVerdict;

const imports = {
  'src/main.tsx': ['react', 'react-dom/client', './App'],
  'src/App.tsx': ['react', 'chart.js/auto', '@tanstack/react-table'],
  'scratch/old.tsx': ['left-pad'],
};

describe('loadedMissingPackageUses', () => {
  it('names the missing packages a LOADED file imports, by package not by subpath', () => {
    const uses = loadedMissingPackageUses(imports, ['chart.js', '@tanstack/react-table', 'left-pad'], verdict(['src/main.tsx', 'src/App.tsx']));
    expect(uses).toEqual([
      { package: 'chart.js', file: 'src/App.tsx' },
      { package: '@tanstack/react-table', file: 'src/App.tsx' },
    ]);
  });

  it('a stray file nothing loads never blocks', () => {
    expect(loadedMissingPackageUses(imports, ['left-pad'], verdict(['src/main.tsx', 'src/App.tsx']))).toEqual([]);
  });

  it('no reachability verdict (or a withheld one) blocks nothing — never a block on a guess', () => {
    expect(loadedMissingPackageUses(imports, ['chart.js'], null)).toEqual([]);
    expect(loadedMissingPackageUses(imports, ['chart.js'], { ...verdict([]), applicable: false } as ReachabilityVerdict)).toEqual([]);
  });

  it('our own e2e scaffold is skipped', () => {
    const uses = loadedMissingPackageUses({ 'e2e/app.spec.ts': ['@playwright/test'] }, ['@playwright/test'], verdict(['e2e/app.spec.ts']), new Set(['e2e/app.spec.ts']));
    expect(uses).toEqual([]);
  });

  it('the labels say what fails and what to do', () => {
    expect(notInstalledBlockerLabel([{ package: 'chart.js', file: 'src/App.tsx' }])).toContain('Cannot find module');
    expect(undeclaredInstalledLabel([{ package: 'chart.js', file: 'src/App.tsx' }])).toContain('a fresh install');
  });
});

describe('the wiring', () => {
  const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

  it('re-collects AFTER the allowlist reconciler, so a package the heal just added never blocks', () => {
    const heal = src.indexOf('applyWellKnownMissingDeps({');
    const gate = src.indexOf('loadedMissingPackageUses(graph.imports, stillMissing, reach, skip)');
    expect(heal).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(heal);
    expect(src).toContain("const stillMissing = (await this.collectDependencyIssues()).filter((d) => d.kind === 'missing')");
  });

  it('blocks only where an install populated node_modules, and only for a package absent from it', () => {
    expect(src).toContain("'node_modules/.package-lock.json'");
    expect(src).toContain('`node_modules/${u.package}/package.json`');
    expect(src).toContain("if (notInstalled.length) extra.push({ severity: 'high', label: notInstalledBlockerLabel(notInstalled) });");
    expect(src).toContain("if (installedOnly.length) extra.push({ severity: 'medium', label: undeclaredInstalledLabel(installedOnly) });");
  });
});
