import { describe, it, expect } from 'vitest';
import { scaffoldGuard, scaffoldGuardMessage } from './ScaffoldGuard';

describe('scaffoldGuard', () => {
  it('blocks create-* project generators that fail on the sandbox Node', () => {
    const blocked = [
      'npm create vite@latest todo-app',
      'npm create vite my-app -- --template react-ts',
      'pnpm create vite',
      'yarn create vite my-app',
      'bun create vite',
      'npx create-vite todo-app',
      'npx create-react-app my-app',
      'npx -y create-next-app@latest app',
      'npx @scope/create-foo',
      'npm init vite@latest',
      'pnpm init react-app',
      'create-react-app my-app',
      'create-next-app',
    ];
    for (const cmd of blocked) {
      const r = scaffoldGuard(cmd);
      expect(r.blocked, cmd).toBe(true);
      expect(r.reason, cmd).toMatch(/newer Node/i);
    }
  });

  it('does NOT block ordinary build / install / run / git commands', () => {
    const allowed = [
      'npm install',
      'npm i react',
      'npm ci',
      'npm run dev',
      'npm run build',
      'npm run dev -- --host 0.0.0.0 --port 5173',
      'npm init -y',
      'npm init --yes',
      'npm init', // bare interactive init creates only package.json
      'npx vite',
      'npx tsc --noEmit',
      'npx eslint .',
      'git init',
      'git commit -m "feat: create user form"', // "create" in a message, not a generator
      'node create-data.js', // a project script named create-*, not the npx generator
      'ls -la',
    ];
    for (const cmd of allowed) {
      expect(scaffoldGuard(cmd).blocked, cmd).toBe(false);
    }
  });

  it('returns not-blocked for empty / whitespace input', () => {
    expect(scaffoldGuard('').blocked).toBe(false);
    expect(scaffoldGuard('   ').blocked).toBe(false);
  });
});

describe('scaffoldGuardMessage', () => {
  it('lists the existing root files and steers away from a nested subdir', () => {
    const msg = scaffoldGuardMessage('reason text', [
      'package.json',
      'src/App.tsx',
      'node_modules/react/index.js',
    ]);
    expect(msg).toContain('BLOCKED (scaffold guard): reason text');
    expect(msg).toContain('ROOT');
    expect(msg).toContain('package.json');
    expect(msg).toContain('src/App.tsx');
    // node_modules paths are filtered out of the listing
    expect(msg).not.toContain('node_modules/react/index.js');
    expect(msg).toMatch(/do NOT create a nested project subdirectory/i);
  });

  it('falls back to a default file hint when no files are known', () => {
    const msg = scaffoldGuardMessage('reason', []);
    expect(msg).toContain('root scaffold prepared');
  });
});
