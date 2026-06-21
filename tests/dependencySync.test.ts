import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { syncDependencies } from '../src/server/project/DependencySync';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

describe('syncDependencies', () => {
  it('adds an undeclared import with its curated version', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { react: '^18' } }),
      'src/app.ts': "import axios from 'axios';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).toContain('axios');
    const pkg = JSON.parse(vfs.readText('package.json')!);
    expect(pkg.dependencies.axios).toBe('^1.7.0');
  });

  it('adds an unknown package with version "latest"', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: {} }),
      'src/app.ts': "import weirdPkg from 'weird-unknown-pkg';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).toContain('weird-unknown-pkg');
    const pkg = JSON.parse(vfs.readText('package.json')!);
    expect(pkg.dependencies['weird-unknown-pkg']).toBe('latest');
  });

  it('does not duplicate or change an already-declared dependency', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { react: '^17' } }),
      'src/app.tsx': "import React from 'react';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).not.toContain('react');
    const pkg = JSON.parse(vfs.readText('package.json')!);
    expect(pkg.dependencies.react).toBe('^17'); // version unchanged
  });

  it('does not add node builtins', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: {} }),
      'src/server.ts': "import fs from 'fs';\nimport path from 'path';\nimport http from 'node:http';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).toHaveLength(0);
    expect(result.added).not.toContain('fs');
    expect(result.added).not.toContain('path');
  });

  it('does not add relative imports', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: {} }),
      'src/app.ts': "import foo from './foo';\nimport bar from '../bar';\nimport baz from '/absolute';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).toHaveLength(0);
  });

  it('is a no-op for a static project with no package.json', () => {
    const vfs = vfsFrom({
      'index.html': '<script src="app.js"></script>',
      'app.js': 'var x = 1;',
    });
    const result = syncDependencies(vfs);
    expect(result.added).toHaveLength(0);
  });

  it('gives known packages their curated version', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: {} }),
      'src/app.tsx': "import { useNavigate } from 'react-router-dom';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).toContain('react-router-dom');
    const pkg = JSON.parse(vfs.readText('package.json')!);
    expect(pkg.dependencies['react-router-dom']).toBe('^6.26.0');
  });

  it('returns the added list sorted alphabetically', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: {} }),
      'src/app.ts': "import axios from 'axios';\nimport { create } from 'zustand';\nimport { format } from 'date-fns';",
    });
    const result = syncDependencies(vfs);
    expect(result.added.length).toBeGreaterThan(1);
    expect(result.added).toEqual([...result.added].sort());
  });

  it('respects devDependencies as already-declared', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ devDependencies: { zod: '^3' } }),
      'src/app.ts': "import { z } from 'zod';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).not.toContain('zod');
    const pkg = JSON.parse(vfs.readText('package.json')!);
    expect(pkg.devDependencies.zod).toBe('^3'); // unchanged
  });

  it('creates package.json dependencies key if absent', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ name: 'myapp', version: '1.0.0' }),
      'src/app.ts': "import { create } from 'zustand';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).toContain('zustand');
    const pkg = JSON.parse(vfs.readText('package.json')!);
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies.zustand).toBe('^4.5.0');
  });

  it('does not mutate package.json when nothing is missing', () => {
    const original = JSON.stringify({ dependencies: { react: '^18', axios: '^1' } });
    const vfs = vfsFrom({
      'package.json': original,
      'src/app.tsx': "import React from 'react';\nimport axios from 'axios';",
    });
    const result = syncDependencies(vfs);
    expect(result.added).toHaveLength(0);
    expect(vfs.readText('package.json')).toBe(original); // file untouched
  });
});
