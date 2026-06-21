import { describe, it, expect } from 'vitest';
import { StaticProvider } from '../src/server/AppMakerLab/generator/templates/StaticProvider';
import { NodeExpressProvider } from '../src/server/AppMakerLab/generator/templates/NodeExpressProvider';
import { NextjsProvider } from '../src/server/AppMakerLab/generator/templates/NextjsProvider';
import { SvelteProvider } from '../src/server/AppMakerLab/generator/templates/SvelteProvider';
import { VueProvider } from '../src/server/AppMakerLab/generator/templates/VueProvider';
import { PythonFastapiProvider } from '../src/server/AppMakerLab/generator/templates/PythonFastapiProvider';
import { TemplateRegistry } from '../src/server/AppMakerLab/generator/templates/TemplateRegistry';

describe('StaticProvider', () => {
  const provider = new StaticProvider();

  it('getFiles returns index.html, style.css, script.js', () => {
    const files = provider.getFiles([]);
    expect(files['index.html']).toBeDefined();
    expect(files['style.css']).toBeDefined();
    expect(files['script.js']).toBeDefined();
  });

  it('index.html contains <html>', () => {
    const files = provider.getFiles([]);
    expect(files['index.html']).toContain('<html');
  });
});

describe('NodeExpressProvider', () => {
  const provider = new NodeExpressProvider();

  it('getFiles returns package.json', () => {
    const files = provider.getFiles([]);
    expect(files['package.json']).toBeDefined();
  });

  it('package.json includes express dependency', () => {
    const files = provider.getFiles([]);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['express']).toBeDefined();
  });

  it('returns a src/index.ts entry file', () => {
    const files = provider.getFiles([]);
    expect(files['src/index.ts']).toBeDefined();
  });
});

describe('NextjsProvider', () => {
  const provider = new NextjsProvider();

  it('getFiles returns package.json with next dependency', () => {
    const files = provider.getFiles([]);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['next']).toBeDefined();
  });

  it('returns an app directory entry file', () => {
    const files = provider.getFiles([]);
    const keys = Object.keys(files);
    expect(keys.some(k => k.includes('page'))).toBe(true);
  });
});

describe('SvelteProvider', () => {
  const provider = new SvelteProvider();

  it('getFiles returns package.json with svelte dependency', () => {
    const files = provider.getFiles([]);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['svelte']).toBeDefined();
  });

  it('returns src/App.svelte', () => {
    const files = provider.getFiles([]);
    expect(files['src/App.svelte']).toBeDefined();
  });

  it('index.html mounts to #app', () => {
    const files = provider.getFiles([]);
    expect(files['index.html']).toContain('id="app"');
  });
});

describe('VueProvider', () => {
  const provider = new VueProvider();

  it('getFiles returns package.json with vue dependency', () => {
    const files = provider.getFiles([]);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['vue']).toBeDefined();
  });

  it('returns src/App.vue', () => {
    const files = provider.getFiles([]);
    expect(files['src/App.vue']).toBeDefined();
  });

  it('returns tsconfig.json', () => {
    const files = provider.getFiles([]);
    expect(files['tsconfig.json']).toBeDefined();
  });
});

describe('PythonFastapiProvider', () => {
  const provider = new PythonFastapiProvider();

  it('getFiles returns requirements.txt', () => {
    const files = provider.getFiles([]);
    expect(files['requirements.txt']).toBeDefined();
  });

  it('requirements.txt includes fastapi', () => {
    const files = provider.getFiles([]);
    expect(files['requirements.txt']).toContain('fastapi');
  });

  it('returns main.py with FastAPI app', () => {
    const files = provider.getFiles([]);
    expect(files['main.py']).toContain('FastAPI');
  });
});

describe('TemplateRegistry', () => {
  const registry = new TemplateRegistry();

  it('returns ViteReactProvider for "vite-react"', () => {
    const provider = registry.getProvider('vite-react');
    const files = provider.getFiles([]);
    expect(files['package.json']).toBeDefined();
  });

  it('returns SvelteProvider for "svelte"', () => {
    const provider = registry.getProvider('svelte');
    const files = provider.getFiles([]);
    expect(files['src/App.svelte']).toBeDefined();
  });

  it('throws for unknown framework', () => {
    expect(() => registry.getProvider('unknown-framework')).toThrow();
  });
});
