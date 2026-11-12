// Autopsy BR1959 (2026-11-09) — "Build a school management app with all features nav bar …".
//
// The fast lane's Navbar and App imported `react-router-dom`; the scaffold's package.json did not declare it.
// The lane type-checked BEFORE installing anything (its only dependency reconcile ran in fastPreview, after
// verify passed), so `tsc` reported TS2307 five times, a paid repair that cannot install packages changed
// nothing, and the build was handed to the full builder at 379 s. The sibling: fastPreview's reconcile read
// only the lane's own writes, so a lane that never wrote package.json counted `react` as undeclared.
// These hold the plan (fastLaneDependencies.ts) and where the route runs it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fastLaneDependencyPlan, fastLaneDependencyInstallCommand, fastLaneDependencyNote } from '../src/server/AgentV3/fastLaneDependencies';

const SCAFFOLD_PKG = JSON.stringify({
  name: 'app', private: true, type: 'module',
  scripts: { dev: 'vite', build: 'tsc && vite build' },
  dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
  devDependencies: { typescript: '^5.4.0', vite: '^5.4.0', '@vitejs/plugin-react': '^4.3.0' },
}, null, 2);

// The two BR1959 files that imported the router (heads, as captured in the report).
const NAVBAR = 'import React from "react";\nimport { Link, useLocation } from "react-router-dom";\nimport type { NavbarProps } from "../types";\nexport default function Navbar(p: NavbarProps) { const l = useLocation(); return <nav className="nb-header"><Link to="/">SchoolManager</Link>{l.pathname}</nav>; }\n';
const APP = "import React, { useState } from 'react';\nimport { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';\nimport Navbar from './components/Navbar';\nexport default function App() { return <Router><Navbar /></Router>; }\n";

describe('the plan: what the code imports and nobody declared', () => {
  it('BR1959: the router is ADDED to the on-disk package.json at its pinned range — react is not touched', () => {
    const plan = fastLaneDependencyPlan({ 'src/components/Navbar.tsx': NAVBAR, 'src/App.tsx': APP }, SCAFFOLD_PKG);
    expect(plan.manifest).toBe('disk');
    expect(plan.pinned).toEqual([{ package: 'react-router-dom', version: '^6' }]);
    expect(plan.unpinned).toEqual([]);
    const pkg = JSON.parse(plan.packageJson!);
    expect(pkg.dependencies['react-router-dom']).toBe('^6');
    // add-only: every dependency the scaffold declared is still there, at its version
    expect(pkg.dependencies.react).toBe('^18.3.1');
    expect(pkg.devDependencies.typescript).toBe('^5.4.0');
    expect(pkg.scripts.build).toBe('tsc && vite build');
    expect(fastLaneDependencyInstallCommand(plan)).toBe('npm install --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps');
  });

  it('the SIBLING: with no package.json among the writes, the disk manifest is read — `react` is never "missing"', () => {
    const plan = fastLaneDependencyPlan({ 'src/App.tsx': "import React from 'react';\nexport default () => null;\n" }, SCAFFOLD_PKG);
    expect(plan).toEqual({ manifest: 'disk', packageJson: null, pinned: [], unpinned: [] });
    expect(fastLaneDependencyInstallCommand(plan)).toBeNull();
  });

  it('a package the lane wrote into its OWN package.json wins over the disk copy', () => {
    const written = JSON.stringify({ dependencies: { react: '^18.3.1', 'react-router-dom': '^6.22.0' } });
    const plan = fastLaneDependencyPlan({ 'package.json': written, 'src/App.tsx': APP }, SCAFFOLD_PKG);
    expect(plan.manifest).toBe('written');
    expect(plan.pinned).toEqual([]);
    expect(plan.unpinned).toEqual([]);
  });

  it('no manifest anywhere → nothing is guessed; an unreadable one is never rewritten', () => {
    expect(fastLaneDependencyPlan({ 'src/App.tsx': APP }, null)).toEqual({ manifest: 'none', packageJson: null, pinned: [], unpinned: [] });
    expect(fastLaneDependencyPlan({ 'src/App.tsx': APP }, '{ not json')).toEqual({ manifest: 'disk', packageJson: null, pinned: [], unpinned: [] });
  });

  it('an import outside the allowlist is installed by name (shell-safe only); a hostile specifier never reaches the shell', () => {
    const src = "import x from 'left-pad-ish';\nimport y from 'bad;rm -rf';\nexport default [x, y];\n";
    const plan = fastLaneDependencyPlan({ 'src/a.ts': src }, SCAFFOLD_PKG);
    expect(plan.unpinned).toEqual(['left-pad-ish']);
    expect(fastLaneDependencyInstallCommand(plan)).toBe('npm install --no-audit --no-fund left-pad-ish || npm install --no-audit --no-fund --legacy-peer-deps left-pad-ish');
  });

  it('when the pinned package.json could not be written, the pinned packages are still installed AT their range', () => {
    const plan = fastLaneDependencyPlan({ 'src/App.tsx': APP }, SCAFFOLD_PKG);
    expect(fastLaneDependencyInstallCommand(plan, false)).toBe("npm install --no-audit --no-fund 'react-router-dom@^6' || npm install --no-audit --no-fund --legacy-peer-deps 'react-router-dom@^6'");
  });

  it('the note says what ran, and says so honestly when the install failed', () => {
    const plan = fastLaneDependencyPlan({ 'src/App.tsx': APP }, SCAFFOLD_PKG);
    expect(fastLaneDependencyNote(plan, 'verify', true)).toBe('Installed 1 package(s) the code imports but package.json did not declare, before the compile check: react-router-dom@^6.');
    expect(fastLaneDependencyNote(plan, 'preview', false)).toContain('the install reported an error');
    expect(fastLaneDependencyNote(fastLaneDependencyPlan({}, SCAFFOLD_PKG), 'verify', true)).toBe('');
  });
});

describe('where the route runs it', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  const verifyStart = route.indexOf('const fastVerifyOnce = async ()');
  const tscAt = route.indexOf('${TSC_BIN} --noEmit > /tmp/nb_tsc.log', verifyStart);
  const previewStart = route.indexOf('const fastPreview = async ()');
  const devAt = route.indexOf("id: 'fast-dev'", previewStart);

  it('fastVerifyOnce reconciles dependencies BEFORE it runs tsc', () => {
    expect(verifyStart).toBeGreaterThan(0);
    expect(tscAt).toBeGreaterThan(verifyStart);
    const reconcileAt = route.indexOf("await fastReconcileDependencies('verify')", verifyStart);
    expect(reconcileAt).toBeGreaterThan(verifyStart);
    expect(reconcileAt).toBeLessThan(tscAt);
  });

  it('fastPreview uses the same plan before the dev server, and the lane-writes-only scan is gone', () => {
    const reconcileAt = route.indexOf("await fastReconcileDependencies('preview')", previewStart);
    expect(reconcileAt).toBeGreaterThan(previewStart);
    expect(reconcileAt).toBeLessThan(devAt);
    expect(route).not.toContain('findMissingDependencies(Object.fromEntries(writtenFiles))');
  });

  it('the closure reads the disk manifest only when the lane wrote none, writes through the lane fence, and records what ran', () => {
    const start = route.indexOf('const fastReconcileDependencies = async');
    const body = route.slice(start, route.indexOf('const fastPreview = async ()', start));
    expect(body).toContain("typeof written['package.json'] === 'string' ? null : await actuator.readFile(workspaceId, 'package.json')");
    expect(body).toContain('await fastWrite(pkgWrite)');
    expect(body).toContain("code: 'FASTLANE_DEPS_RECONCILED'");
    expect(body).toContain('fastLaneDependencyNote(plan, stage, !res.is_error)');
  });
});
