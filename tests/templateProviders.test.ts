import { describe, it, expect } from 'vitest';
import { StaticProvider } from '../src/server/AppMakerLab/generator/templates/StaticProvider';
import { NodeExpressProvider } from '../src/server/AppMakerLab/generator/templates/NodeExpressProvider';
import { NextjsProvider } from '../src/server/AppMakerLab/generator/templates/NextjsProvider';

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
