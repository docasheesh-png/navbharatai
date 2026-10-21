import { describe, expect, it } from 'vitest';
import { runSimpleBuild } from './SimpleBuilder';

async function build(scaffoldPaths: string[], generated: Record<string, string> = {}, includeDefaultFiles = true) {
  const writes: Array<{ path: string; content: string }> = [];
  const files: Record<string, string> = {
    ...(includeDefaultFiles ? {
      'src/App.tsx': `import styles from './Card.module.css';
import { Star } from './icons';
export default function App() { return <div className={styles.card}><Star /></div>; }`,
      'src/icons/Star.tsx': 'export const Star = () => <span>star</span>;',
      'src/index.css': 'body { margin: 0; }',
    } : {}),
    ...generated,
  };
  const result = await runSimpleBuild({
    prompt: 'build a small card app', framework: 'vite-react', scaffoldPaths,
    shareContract: false,
    generate: async (_system, user) => {
      if (user.includes('Plan the file list')) return Object.keys(files).map(path => `${path} :: app file`).join('\n');
      const path = /write THIS file in full:\s*\n\s*([^\n]+)/.exec(user)?.[1]?.trim();
      if (!path || !(path in files)) throw new Error('Unexpected generation request');
      return `<<<FILE ${path}>>>\n${files[path]}\n<<<ENDFILE>>>`;
    },
    writeFiles: async files => { writes.push(...files); },
  });
  expect(result.ok).toBe(true);
  return writes;
}

describe('fast-lane missing-module repair preserves existing workspace modules', () => {
  it('does not overwrite a scaffold stylesheet with empty class hooks', async () => {
    const writes = await build(['index.html', 'src/Card.module.css']);
    expect(writes.some(file => file.path === 'src/Card.module.css')).toBe(false);
    expect(writes.some(file => file.path === 'src/icons/index.ts')).toBe(true);
  });

  it('does not replace an existing barrel or lose its additional exports', async () => {
    const writes = await build(['index.html', 'src/icons/index.ts']);
    expect(writes.some(file => file.path === 'src/icons/index.ts')).toBe(false);
    expect(writes.some(file => file.path === 'src/Card.module.css')).toBe(true);
  });

  it.each(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'])(
    'respects an existing index.%s barrel rather than shadowing it with index.ts', async extension => {
      const path = `src/icons/index.${extension}`;
      const writes = await build(['index.html', path]);
      expect(writes.some(file => file.path === 'src/icons/index.ts')).toBe(false);
      expect(writes.some(file => file.path === path)).toBe(false);
    },
  );

  it('allows explicit generation of an existing module without replacing it with a stub', async () => {
    const content = '.card { color: rebeccapurple; }';
    const writes = await build(['index.html', 'src/Card.module.css'], { 'src/Card.module.css': content });
    expect(writes.filter(file => file.path === 'src/Card.module.css')).toEqual([
      { path: 'src/Card.module.css', content },
    ]);
  });

  it('does not turn unread scaffold source into proof for a transitive star barrel', async () => {
    const writes = await build(['index.html', 'src/unknown.ts'], {
      'src/App.tsx': `import { Star } from './icons'; export default () => <Star />;`,
      'src/shared/Star.tsx': 'export const Star = () => null;',
      'src/icons/All.ts': `export * from '../shared/Star'; export * from '../unknown';`,
      'src/index.css': 'body { margin: 0; }',
    }, false);
    expect(writes.some(file => file.path === 'src/icons/index.ts')).toBe(false);
  });

  it('still creates genuinely absent stylesheets and barrels', async () => {
    const writes = await build(['index.html']);
    expect(writes.find(file => file.path === 'src/Card.module.css')?.content).toContain('.card {');
    expect(writes.find(file => file.path === 'src/icons/index.ts')?.content).toContain("export { Star } from './Star';");
  });
});
