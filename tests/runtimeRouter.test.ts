import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { analyzeProject, chooseRuntime, routeRuntime } from '../src/server/runtime/RuntimeRouter';

const vfsFrom = (files: Record<string, string>) => VirtualFileSystem.fromRecord(files);

describe('RuntimeRouter.analyzeProject', () => {
  it('detects a pure static site', () => {
    const p = analyzeProject(vfsFrom({ 'index.html': '<h1>hi</h1>', 'style.css': 'body{}' }));
    expect(p.hasPackageJson).toBe(false);
    expect(p.isStatic).toBe(true);
    expect(p.needsNodeServer).toBe(false);
  });

  it('detects a Vite frontend project', () => {
    const p = analyzeProject(vfsFrom({
      'package.json': JSON.stringify({ devDependencies: { vite: '^5' }, dependencies: { react: '^18' } }),
      'index.html': '<div id=root></div>',
    }));
    expect(p.framework).toBe('vite');
    expect(p.needsNodeServer).toBe(false);
  });

  it('detects an Express/Node server project', () => {
    const p = analyzeProject(vfsFrom({
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'server.js': 'require("express")()',
    }));
    expect(p.framework).toBe('node');
    expect(p.needsNodeServer).toBe(true);
  });

  it('flags Next.js as needing a server', () => {
    const p = analyzeProject(vfsFrom({ 'package.json': JSON.stringify({ dependencies: { next: '^14', react: '^18' } }) }));
    expect(p.framework).toBe('next');
    expect(p.needsNodeServer).toBe(true);
  });
});

describe('RuntimeRouter.chooseRuntime', () => {
  it('static → static', () => {
    expect(chooseRuntime(analyzeProject(vfsFrom({ 'index.html': '<h1>x</h1>' })))).toBe('static');
  });
  it('vite frontend → webcontainer', () => {
    expect(routeRuntime(vfsFrom({
      'package.json': JSON.stringify({ devDependencies: { vite: '^5' } }), 'index.html': 'x',
    })).target).toBe('webcontainer');
  });
  it('express backend → server-container', () => {
    expect(routeRuntime(vfsFrom({
      'package.json': JSON.stringify({ dependencies: { express: '^4', mongoose: '^8' } }),
    })).target).toBe('server-container');
  });
  it('next → server-container', () => {
    expect(routeRuntime(vfsFrom({
      'package.json': JSON.stringify({ dependencies: { next: '^14' } }),
    })).target).toBe('server-container');
  });
});
