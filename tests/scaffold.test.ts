import { describe, it, expect } from 'vitest';
import { detectFramework, scaffold, scaffoldSummary } from '../src/server/project/Scaffold';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

describe('detectFramework', () => {
  it('returns vite-react for react prompt', () => {
    expect(detectFramework('build a react dashboard')).toBe('vite-react');
  });

  it('returns vite-react-ts for typescript react prompt', () => {
    expect(detectFramework('build a React app with TypeScript')).toBe('vite-react-ts');
  });

  it('returns vite-vue for vue prompt', () => {
    expect(detectFramework('build an app with vue 3')).toBe('vite-vue');
  });

  it('returns vite-svelte for svelte prompt', () => {
    expect(detectFramework('build a svelte app')).toBe('vite-svelte');
  });

  it('returns static for plain html prompt', () => {
    expect(detectFramework('make a plain landing page')).toBe('static');
  });

  it('returns vite-pocketbase for pocketbase prompt', () => {
    expect(detectFramework('build an app with PocketBase backend')).toBe('vite-pocketbase');
  });

  it('returns vite-convex for convex prompt', () => {
    expect(detectFramework('build an app with Convex')).toBe('vite-convex');
  });

  it('returns static for empty prompt', () => {
    expect(detectFramework('')).toBe('static');
  });
});

describe('scaffold', () => {
  it('returns null when VFS already has files (no-op)', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<h1>hi</h1>' });
    expect(scaffold(vfs, 'vite-react')).toBeNull();
  });

  it('writes files into empty VFS and returns the framework', () => {
    const vfs = VirtualFileSystem.fromRecord({});
    const result = scaffold(vfs, 'vite-react');
    expect(result).toBe('vite-react');
    expect(vfs.count).toBeGreaterThan(0);
  });

  it('includes package.json in scaffolded vite-react project', () => {
    const vfs = VirtualFileSystem.fromRecord({});
    scaffold(vfs, 'vite-react');
    expect(vfs.readText('package.json')).toBeTruthy();
  });

  it('bakes preview-reachable server config into the Vite scaffold (host/strictPort/allowedHosts)', () => {
    for (const fw of ['vite-react', 'vite-react-ts', 'vite-vue', 'vite-svelte'] as const) {
      const vfs = VirtualFileSystem.fromRecord({});
      scaffold(vfs, fw);
      const cfg = vfs.readText('vite.config.js') || vfs.readText('vite.config.ts') || '';
      // host:true → reachable cloud preview; strictPort → no 5173→5174 drift; allowedHosts →
      // no "Blocked request … is not allowed". Baked in so the agent never edits the config mid-build.
      expect(cfg).toContain('host: true');
      expect(cfg).toContain('strictPort: true');
      expect(cfg).toContain('allowedHosts: true');
    }
  });

  it('bundles the Tailwind toolchain so a Tailwind-using app builds + is styled (vite-react + vite-react-ts)', () => {
    for (const fw of ['vite-react', 'vite-react-ts'] as const) {
      const vfs = VirtualFileSystem.fromRecord({});
      scaffold(vfs, fw);
      // Dev deps must declare tailwindcss/postcss/autoprefixer — else `npm run dev` crashes with
      // "Cannot find module 'tailwindcss'" the moment the generated app references Tailwind.
      const pkg = JSON.parse(vfs.readText('package.json') || '{}');
      const dev = pkg.devDependencies || {};
      expect(dev.tailwindcss).toBeTruthy();
      expect(dev.postcss).toBeTruthy();
      expect(dev.autoprefixer).toBeTruthy();
      // Config + directives present so PostCSS actually generates the utilities.
      expect(vfs.readText('postcss.config.js')).toContain('tailwindcss');
      expect(vfs.readText('tailwind.config.js')).toContain('content');
      expect(vfs.readText('src/index.css')).toContain('@tailwind base');
    }
  });
});

describe('scaffoldSummary', () => {
  it('returns a non-empty description for every framework', () => {
    const frameworks = ['vite-react', 'vite-react-ts', 'vite-vue', 'vite-svelte', 'vite-pocketbase', 'vite-convex', 'static'] as const;
    for (const fw of frameworks) {
      expect(scaffoldSummary(fw).length).toBeGreaterThan(0);
    }
  });

  it('mentions TypeScript for vite-react-ts', () => {
    expect(scaffoldSummary('vite-react-ts')).toContain('TypeScript');
  });
});
