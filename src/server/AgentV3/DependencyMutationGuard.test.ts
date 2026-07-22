import { describe, it, expect } from 'vitest';
import { dependencyMutationGuard, dependencyMutationGuardMessage } from './DependencyMutationGuard';

describe('dependencyMutationGuard — the `npm audit fix --force` that killed a live preview', () => {
  it('BLOCKS the exact command from build 5ed0424a (npm audit fix --force)', () => {
    const b = dependencyMutationGuard('npm audit fix --force');
    expect(b).not.toBeNull();
    expect(b!.kind).toBe('audit-fix');
    // message is actionable + explains why
    const msg = dependencyMutationGuardMessage(b!);
    expect(msg).toMatch(/BLOCKED \(dependency guard\)/);
    expect(msg).toMatch(/audit fix/i);
    expect(msg).toMatch(/preview/i);
  });

  it('ALLOWS plain `npm audit fix` WITHOUT --force (semver-safe, not destructive — only --force is blocked)', () => {
    // admin 2026-07-22: "only destructive command ko rokna chahiye". Plain audit fix stays within the
    // declared ranges and cannot cross a major, so it is deliberately NOT blocked.
    expect(dependencyMutationGuard('npm audit fix')).toBeNull();
    expect(dependencyMutationGuard('npm audit fix -f')).not.toBeNull(); // -f IS the force short flag → blocked
  });

  it('BLOCKS the pnpm / yarn / bun audit-fix --force variants (siblings)', () => {
    expect(dependencyMutationGuard('pnpm audit fix --force')).not.toBeNull();
    expect(dependencyMutationGuard('yarn audit fix --force')).not.toBeNull();
    expect(dependencyMutationGuard('bun audit fix --force')).not.toBeNull();
  });

  it('BLOCKS it even when chained or piped (real agents wrap commands)', () => {
    expect(dependencyMutationGuard('cd /home/user/workspace && npm audit fix --force')).not.toBeNull();
    expect(dependencyMutationGuard('npm audit fix --force 2>&1 | tail -20')).not.toBeNull();
  });
});

describe('dependencyMutationGuard — core tools at a moving tag (the cross-major sibling)', () => {
  it('BLOCKS `npm i vite@latest` (this is exactly the v5→v8 jump, made explicit)', () => {
    const b = dependencyMutationGuard('npm i vite@latest');
    expect(b).not.toBeNull();
    expect(b!.kind).toBe('core-moving-tag');
  });

  it('BLOCKS moving tags on the other core tools + package managers', () => {
    expect(dependencyMutationGuard('npm install react@latest react-dom@latest')).not.toBeNull();
    expect(dependencyMutationGuard('npm install typescript@next')).not.toBeNull();
    expect(dependencyMutationGuard('yarn add @vitejs/plugin-react@latest')).not.toBeNull();
    expect(dependencyMutationGuard('pnpm add next@canary')).not.toBeNull();
  });
});

describe('dependencyMutationGuard — bulk whole-tree upgrades (same class as audit fix --force)', () => {
  it('BLOCKS npm-check-updates / ncu -u (rewrites package.json to latest majors)', () => {
    expect(dependencyMutationGuard('npx npm-check-updates -u')).not.toBeNull();
    expect(dependencyMutationGuard('ncu -u')).not.toBeNull();
    expect(dependencyMutationGuard('npm-check-updates --upgrade')).not.toBeNull();
    expect(dependencyMutationGuard('ncu -u')!.kind).toBe('bulk-upgrade');
  });

  it('BLOCKS npm/pnpm/yarn update --latest (cross-major bump of everything)', () => {
    expect(dependencyMutationGuard('npm update --latest')).not.toBeNull();
    expect(dependencyMutationGuard('pnpm update --latest')).not.toBeNull();
    expect(dependencyMutationGuard('yarn upgrade --latest')).not.toBeNull();
  });

  it('does NOT block a plain, semver-respecting `npm update` (stays within the declared majors)', () => {
    expect(dependencyMutationGuard('npm update')).toBeNull();
    expect(dependencyMutationGuard('npm update react-router-dom')).toBeNull();
  });
});

describe('dependencyMutationGuard — must NOT block legitimate installs (zero false positives)', () => {
  it('allows a normal missing-dependency install', () => {
    expect(dependencyMutationGuard('npm install class-variance-authority')).toBeNull();
    expect(dependencyMutationGuard('npm install react-router-dom recharts lucide-react')).toBeNull();
    expect(dependencyMutationGuard('npm install --no-audit --no-fund @dnd-kit/modifiers')).toBeNull();
  });

  it('allows installing a core tool at a PINNED numeric version (a deliberate, safe choice)', () => {
    expect(dependencyMutationGuard('npm install vite@5.4.10')).toBeNull();
    expect(dependencyMutationGuard('npm install react@^18.3.1 react-dom@^18.3.1')).toBeNull();
  });

  it('allows a plain install / the scaffold install command', () => {
    expect(dependencyMutationGuard('npm install')).toBeNull();
    expect(dependencyMutationGuard('npm install --legacy-peer-deps')).toBeNull();
    expect(dependencyMutationGuard('npm ci')).toBeNull();
  });

  it('allows unrelated commands and read-only npm', () => {
    expect(dependencyMutationGuard('npm run dev')).toBeNull();
    expect(dependencyMutationGuard('npm audit')).toBeNull(); // a read-only audit (no `fix`) is harmless
    expect(dependencyMutationGuard('ls -la && cat package.json')).toBeNull();
    expect(dependencyMutationGuard('')).toBeNull();
  });

  it('does not block a non-core package at @latest (only the toolchain is protected)', () => {
    expect(dependencyMutationGuard('npm install lodash@latest')).toBeNull();
  });
});
