import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { generateMissingCssModules } from './CssModuleGenerator';

describe('generated missing CSS modules through the default Vite CSS compiler', () => {
  it.each([false, true])('exports every static consumer class, reversed=%s', async (reverse) => {
    const consumers = [
      ['src/a.tsx', `import a from './shared.module.css'; a.card;`],
      ['src/b.tsx', `import b from './shared.module.css'; b.column; b['is-active'];`],
    ];
    const files = Object.fromEntries(reverse ? consumers.reverse() : consumers);
    const [stub] = generateMissingCssModules(files);
    const root = await mkdtemp(join(tmpdir(), 'css-module-repair-'));
    try {
      await writeFile(join(root, 'shared.module.css'), stub.content);
      await writeFile(join(root, 'entry.js'), `import styles from './shared.module.css'; globalThis.result = styles;`);
      const bundle = await build({
        configFile: false,
        envFile: false,
        root,
        publicDir: false,
        logLevel: 'silent',
        cacheDir: join(root, '.vite'),
        css: { transformer: 'postcss', postcss: { plugins: [] } },
        build: {
          write: false,
          emptyOutDir: false,
          minify: false,
          lib: { entry: join(root, 'entry.js'), formats: ['es'], fileName: 'entry', cssFileName: 'styles' },
        },
      });
      if ('on' in bundle) throw new Error('The synthetic compiler probe must not start a watcher');
      const outputs = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(output => output.output);
      const js = outputs.find(output => output.type === 'chunk');
      expect(js?.type).toBe('chunk');
      if (!js || js.type !== 'chunk') throw new Error('No JavaScript bundle was generated');
      const context: { result?: Record<string, string> } = {};
      runInNewContext(js.code, context);
      expect(Object.keys(context.result ?? {}).sort()).toEqual(['card', 'column', 'is-active']);
      for (const name of ['card', 'column', 'is-active']) expect(context.result?.[name]).toEqual(expect.any(String));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
