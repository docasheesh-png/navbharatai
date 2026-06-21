import { describe, it, expect } from 'vitest';
import { detectFramework, scaffold, scaffoldSummary } from '../src/server/project/Scaffold';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

describe('detectFramework', () => {
  it('picks vite-react for component/SPA-style prompts', () => {
    expect(detectFramework('a react dashboard with routing')).toBe('vite-react');
    expect(detectFramework('build a SPA with components')).toBe('vite-react');
  });

  it('picks static for plain/landing prompts', () => {
    expect(detectFramework('a simple landing page')).toBe('static');
    expect(detectFramework('plain html portfolio')).toBe('static');
  });

  it('honors an explicit react request even when "simple" is present', () => {
    expect(detectFramework('a simple react counter')).toBe('vite-react');
  });
});

describe('scaffold', () => {
  it('seeds a runnable vite-react skeleton with a valid wired entry point', () => {
    const vfs = VirtualFileSystem.fromRecord({});
    expect(scaffold(vfs, 'vite-react')).toBe('vite-react');
    expect(vfs.paths()).toContain('src/main.jsx');
    expect(vfs.paths()).toContain('package.json');
    // entry references main.jsx, which exists → no dangling reference
    expect(vfs.readText('index.html')).toContain('/src/main.jsx');
    // package.json is valid JSON
    expect(() => JSON.parse(vfs.readText('package.json')!)).not.toThrow();
  });

  it('seeds a static skeleton', () => {
    const vfs = VirtualFileSystem.fromRecord({});
    expect(scaffold(vfs, 'static')).toBe('static');
    expect(vfs.paths().sort()).toEqual(['app.js', 'index.html', 'styles.css']);
  });

  it('never overwrites an existing project', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<h1>mine</h1>' });
    expect(scaffold(vfs, 'vite-react')).toBeNull();
    expect(vfs.readText('index.html')).toBe('<h1>mine</h1>');
  });

  it('scaffoldSummary describes the seeded foundation', () => {
    expect(scaffoldSummary('vite-react')).toContain('React');
    expect(scaffoldSummary('static')).toContain('static');
  });

  it('detects TypeScript and seeds a .tsx skeleton with tsconfig', () => {
    expect(detectFramework('a react dashboard in TypeScript')).toBe('vite-react-ts');
    expect(detectFramework('build a react app with typescript and routing')).toBe('vite-react-ts');
    const vfs = VirtualFileSystem.fromRecord({});
    expect(scaffold(vfs, 'vite-react-ts')).toBe('vite-react-ts');
    expect(vfs.paths()).toContain('src/main.tsx');
    expect(vfs.paths()).toContain('tsconfig.json');
    expect(vfs.readText('index.html')).toContain('/src/main.tsx');
    expect(() => JSON.parse(vfs.readText('tsconfig.json')!)).not.toThrow();
  });

  it('plain react (no TS) still scaffolds .jsx', () => {
    expect(detectFramework('a react todo app')).toBe('vite-react');
  });

  it('detects Svelte and seeds a correct Svelte 4 + Vite skeleton', () => {
    expect(detectFramework('build a svelte todo app')).toBe('vite-svelte');
    expect(detectFramework('create a SvelteKit dashboard')).toBe('vite-svelte');
    const vfs = VirtualFileSystem.fromRecord({});
    expect(scaffold(vfs, 'vite-svelte')).toBe('vite-svelte');
    expect(vfs.paths()).toContain('src/App.svelte');
    expect(vfs.paths()).toContain('src/main.js');
    expect(vfs.paths()).toContain('vite.config.js');
    expect(vfs.readText('index.html')).toContain('/src/main.js');
    expect(vfs.readText('vite.config.js')).toContain('@sveltejs/vite-plugin-svelte');
    const pkg = JSON.parse(vfs.readText('package.json')!);
    expect(pkg.dependencies.svelte).toBeTruthy();
    expect(pkg.devDependencies['@sveltejs/vite-plugin-svelte']).toBeTruthy();
  });

  it('scaffoldSummary describes Svelte', () => {
    expect(scaffoldSummary('vite-svelte')).toContain('Svelte');
  });
});
