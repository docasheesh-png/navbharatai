import { describe, it, expect } from 'vitest';
import { isReactApp, isVueApp, isSvelteApp } from '../src/server/project/ArchitectureValidator';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

function reactVfs(): VirtualFileSystem {
  return VirtualFileSystem.fromRecord({
    'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    'src/App.tsx': 'export default function App() { return null; }',
  });
}

function vueVfs(): VirtualFileSystem {
  return VirtualFileSystem.fromRecord({
    'package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' } }),
    'src/App.vue': '<template><div/></template>',
  });
}

function svelteVfs(): VirtualFileSystem {
  return VirtualFileSystem.fromRecord({
    'package.json': JSON.stringify({ dependencies: { svelte: '^4.0.0' } }),
    'src/App.svelte': '<script>let x = 1;</script>',
  });
}

describe('isReactApp', () => {
  it('returns true when package.json has react dependency', () => {
    expect(isReactApp(reactVfs())).toBe(true);
  });

  it('returns true when project has jsx/tsx files (no package.json)', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'src/App.tsx': 'export default () => null' });
    expect(isReactApp(vfs)).toBe(true);
  });

  it('returns false for plain html project', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<html/>' });
    expect(isReactApp(vfs)).toBe(false);
  });
});

describe('isVueApp', () => {
  it('returns true when package.json has vue dependency', () => {
    expect(isVueApp(vueVfs())).toBe(true);
  });

  it('returns true when project has .vue files', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'src/App.vue': '<template/>' });
    expect(isVueApp(vfs)).toBe(true);
  });

  it('returns false for react project', () => {
    expect(isVueApp(reactVfs())).toBe(false);
  });
});

describe('isSvelteApp', () => {
  it('returns true when package.json has svelte dependency', () => {
    expect(isSvelteApp(svelteVfs())).toBe(true);
  });

  it('returns true when project has .svelte files', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'src/App.svelte': '<script/>' });
    expect(isSvelteApp(vfs)).toBe(true);
  });

  it('returns false for react project', () => {
    expect(isSvelteApp(reactVfs())).toBe(false);
  });
});
