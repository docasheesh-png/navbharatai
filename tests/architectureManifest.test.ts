import { describe, it, expect } from 'vitest';
import { selectArchitecture, forbiddenPathPatterns, manifestContract } from '../src/server/project/ArchitectureManifest';

describe('selectArchitecture', () => {
  it('returns react framework for "todo" keyword', () => {
    const m = selectArchitecture('build a todo app');
    expect(m.framework).toBe('react');
  });

  it('returns react framework for "dashboard" keyword', () => {
    const m = selectArchitecture('admin dashboard');
    expect(m.framework).toBe('react');
  });

  it('returns vue framework for explicit "vue" keyword', () => {
    const m = selectArchitecture('build a vue dashboard');
    expect(m.framework).toBe('vue');
  });

  it('returns svelte framework for explicit "svelte" keyword', () => {
    const m = selectArchitecture('svelte app with components');
    expect(m.framework).toBe('svelte');
  });

  it('returns vanilla framework for "plain" or "static" keyword', () => {
    const m = selectArchitecture('plain landing page');
    expect(m.framework).toBe('vanilla');
  });

  it('react entry is .tsx when "typescript" is mentioned', () => {
    const m = selectArchitecture('react app with typescript');
    expect(m.entry).toBe('src/main.tsx');
    expect(m.language).toBe('typescript');
  });

  it('react mountId is "root"', () => {
    const m = selectArchitecture('react dashboard');
    expect(m.mountId).toBe('root');
  });

  it('vue mountId is "app"', () => {
    const m = selectArchitecture('vue 3 app');
    expect(m.mountId).toBe('app');
  });

  it('svelte uses vite bundler', () => {
    const m = selectArchitecture('svelte app');
    expect(m.bundler).toBe('vite');
  });

  it('vanilla bundler is "none"', () => {
    const m = selectArchitecture('simple static html page');
    expect(m.bundler).toBe('none');
  });
});

describe('forbiddenPathPatterns', () => {
  it('react bans /^js\\// path pattern', () => {
    const m = selectArchitecture('react app');
    const patterns = forbiddenPathPatterns(m);
    expect(patterns.some(r => r.test('js/utils.js'))).toBe(true);
  });

  it('vue bans .jsx/.tsx extensions', () => {
    const m = selectArchitecture('vue 3 app');
    const patterns = forbiddenPathPatterns(m);
    expect(patterns.some(r => r.test('src/App.tsx'))).toBe(true);
  });

  it('vanilla bans /^src\\// path', () => {
    const m = selectArchitecture('plain static page');
    const patterns = forbiddenPathPatterns(m);
    expect(patterns.some(r => r.test('src/App.js'))).toBe(true);
  });

  it('svelte bans .jsx extension', () => {
    const m = selectArchitecture('svelte app');
    const patterns = forbiddenPathPatterns(m);
    expect(patterns.some(r => r.test('App.jsx'))).toBe(true);
  });
});

describe('manifestContract', () => {
  it('mentions the framework name for react', () => {
    const m = selectArchitecture('react app');
    const contract = manifestContract(m);
    expect(contract).toContain('React');
  });

  it('mentions Vue 3 for vue framework', () => {
    const m = selectArchitecture('vue 3 app');
    const contract = manifestContract(m);
    expect(contract).toContain('Vue 3');
  });

  it('mentions Svelte for svelte framework', () => {
    const m = selectArchitecture('svelte app');
    const contract = manifestContract(m);
    expect(contract).toContain('Svelte');
  });

  it('mentions the entry file in the contract', () => {
    const m = selectArchitecture('react typescript app');
    const contract = manifestContract(m);
    expect(contract).toContain(m.entry);
  });
});
