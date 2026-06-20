import { describe, it, expect } from 'vitest';
import { NodeExpressProvider } from '../src/server/AppMakerLab/generator/templates/NodeExpressProvider';
import { NextjsProvider } from '../src/server/AppMakerLab/generator/templates/NextjsProvider';
import { TemplateRegistry } from '../src/server/AppMakerLab/generator/templates/TemplateRegistry';

describe('Phase 16 — Production Build Pipelines', () => {
  describe('NodeExpressProvider', () => {
    const files = new NodeExpressProvider().getFiles([]);
    const pkg = JSON.parse(files['package.json']);

    it('uses esbuild for the production build script', () => {
      expect(pkg.scripts.build).toContain('esbuild');
      expect(pkg.scripts.build).toContain('--platform=node');
      expect(pkg.scripts.build).toContain('--outfile=dist/index.js');
    });

    it('outputs to dist/index.js (not a type-check-only build)', () => {
      expect(pkg.scripts.build).not.toContain('--noEmit');
      expect(pkg.scripts.build).toContain('dist/index.js');
    });

    it('has esbuild in devDependencies', () => {
      expect(pkg.devDependencies.esbuild).toBeTruthy();
    });

    it('has a start:prod script that runs the bundle', () => {
      expect(pkg.scripts['start:prod']).toBe('node dist/index.js');
    });

    it('still has a dev script using ts-node', () => {
      expect(pkg.scripts.dev).toContain('ts-node');
    });

    it('scaffolds src/index.ts as the entry point', () => {
      expect(files['src/index.ts']).toBeTruthy();
      expect(files['src/index.ts']).toContain('express');
    });
  });

  describe('NextjsProvider', () => {
    const files = new NextjsProvider().getFiles([]);
    const pkg = JSON.parse(files['package.json']);

    it('has a build script that runs next build', () => {
      expect(pkg.scripts.build).toContain('next build');
    });

    it('scaffolds next.config.js', () => {
      expect(files['next.config.js']).toBeTruthy();
    });

    it('scaffolds app/page.tsx', () => {
      expect(files['app/page.tsx']).toBeTruthy();
    });
  });

  describe('TemplateRegistry', () => {
    const registry = new TemplateRegistry();

    it('resolves node-express to NodeExpressProvider with esbuild build', () => {
      const f = registry.getProvider('node-express').getFiles([]);
      const pkg = JSON.parse(f['package.json']);
      expect(pkg.scripts.build).toContain('esbuild');
    });

    it('resolves nextjs to NextjsProvider with next build script', () => {
      const f = registry.getProvider('nextjs').getFiles([]);
      const pkg = JSON.parse(f['package.json']);
      expect(pkg.scripts.build).toContain('next build');
    });
  });
});
