import { describe, it, expect } from 'vitest';
import { generateMissingCssModules, extractCssModuleClasses } from './CssModuleGenerator';

describe('extractCssModuleClasses', () => {
  it('collects dot-access and bracket-access class names, deduped and sorted', () => {
    const src = `const x = styles.header; return <div className={styles.card}><span className={styles['is-active']}/>{styles.header}</div>;`;
    expect(extractCssModuleClasses(src, 'styles')).toEqual(['card', 'header', 'is-active']);
  });

  it('is scoped to the given binding only (a different object is ignored)', () => {
    const src = `styles.a; other.b; s.c;`;
    expect(extractCssModuleClasses(src, 'styles')).toEqual(['a']);
  });
});

describe('generateMissingCssModules — the Kanban autopsy struggle (12+ missing *.module.css)', () => {
  it('creates a stub for a missing module with exactly the referenced classes', () => {
    const files = {
      'src/components/ui/Select.tsx':
        `import styles from './Select.module.css';\nexport const Select = () => <div className={styles.wrapper}><span className={styles.label}/></div>;`,
    };
    const stubs = generateMissingCssModules(files);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].path).toBe('src/components/ui/Select.module.css');
    expect(stubs[0].classes).toEqual(['label', 'wrapper']);
    expect(stubs[0].content).toContain('.wrapper {');
    expect(stubs[0].content).toContain('.label {');
    expect(stubs[0].content).toContain('Auto-generated'); // honest stub marker
  });

  it('does NOT create a stub when the stylesheet already exists (no overwrite)', () => {
    const files = {
      'src/App.tsx': `import styles from './App.module.css';\n<div className={styles.app}/>;`,
      'src/App.module.css': '.app { color: red; }',
    };
    expect(generateMissingCssModules(files)).toEqual([]);
  });

  it('resolves a ../ relative import to the correct project path', () => {
    const files = {
      'src/components/Card.tsx': `import s from '../styles/Card.module.css';\n<div className={s.body}/>;`,
    };
    const stubs = generateMissingCssModules(files);
    expect(stubs[0].path).toBe('src/styles/Card.module.css');
    expect(stubs[0].classes).toEqual(['body']);
  });

  it('handles a mixed default+named import binding (`import styles, { x }`)', () => {
    const files = { 'src/X.tsx': `import styles, { cx } from './X.module.css';\n<div className={styles.row}/>;` };
    const stubs = generateMissingCssModules(files);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].classes).toEqual(['row']);
  });

  it('still emits a valid (empty) stylesheet when no class is referenced', () => {
    const files = { 'src/Y.tsx': `import './Y.module.css';\nimport styles from './Z.module.css';\nstyles;` };
    const stubs = generateMissingCssModules(files);
    // Z.module.css is imported with a binding but no styles.X usage → empty-but-valid stub.
    const z = stubs.find((s) => s.path === 'src/Z.module.css');
    expect(z).toBeDefined();
    expect(z!.classes).toEqual([]);
    expect(z!.content).toContain('no class references');
  });

  it('dedupes the same missing module imported by two files', () => {
    const files = {
      'src/a.tsx': `import s from './shared.module.css';\n<i className={s.icon}/>;`,
      'src/b.tsx': `import s from './shared.module.css';\n<i className={s.icon}/>;`,
    };
    expect(generateMissingCssModules(files)).toHaveLength(1);
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error malformed
    expect(() => generateMissingCssModules(null)).not.toThrow();
    expect(generateMissingCssModules({})).toEqual([]);
  });
});

// Synthetic repair-contract fixtures, not a reconstruction of any historical build.
describe('CSS module repair uses all real consumers before rendering', () => {
  const consumers = {
    'src/a.tsx': `import first from './shared.module.css'; first.card; first.shared;`,
    'src/nested/b.tsx': `import second from '../shared.module.css'; second.column; second['is-active']; second.shared;`,
  };

  it.each([false, true])('unions distinct aliases and normalized targets, reversed=%s', (reverse) => {
    const files = Object.fromEntries(reverse ? Object.entries(consumers).reverse() : Object.entries(consumers));
    const before = JSON.stringify(files);
    const stubs = generateMissingCssModules(files);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].path).toBe('src/shared.module.css');
    expect(stubs[0].classes).toEqual(['card', 'column', 'is-active', 'shared']);
    for (const name of stubs[0].classes) expect(stubs[0].content).toContain(`.${name} {`);
    expect(JSON.stringify(files)).toBe(before);
  });

  it('unions aliases in one file, including an initial import without class references', () => {
    const files = {
      'src/a.tsx': `import unused from './shared.module.css'; import a from './shared.module.css'; import b from './shared.module.css'; a.card; b.column;`,
    };
    expect(generateMissingCssModules(files)[0].classes).toEqual(['card', 'column']);
  });

  it('ignores commented and quoted import examples, even before a real same-target import', () => {
    const files = {
      'src/a.tsx': `// import stale from './shared.module.css'; stale.old;
        /* import ghost from './ghost.module.css'; ghost.fake; */
        const example = "import quoted from './quoted.module.css'";
        const template = \`import template from './template.module.css'\`;
        import live from './shared.module.css'; live.card;`,
    };
    expect(generateMissingCssModules(files).map(s => [s.path, s.classes])).toEqual([
      ['src/shared.module.css', ['card']],
    ]);
  });

  it('does not infer classes from comments, quoted examples or nested nonbinding properties', () => {
    const source = `// styles.lineComment
      /* styles.blockComment */
      const quoted = 'styles.quoted'; const template = \`styles.template\`;
      const obj = {styles: {nested: 'not the import'}}; obj.styles.nested;
      styles.real; styles['literal']; styles . spaced; styles?.optional;
      styles[ /* hint */ 'commentBetweenTokens' ];`;
    expect(extractCssModuleClasses(source, 'styles')).toEqual([
      'commentBetweenTokens', 'literal', 'optional', 'real', 'spaced',
    ]);
  });

  it('keeps exactly the existing class-name filter and does not guess computed accesses', () => {
    expect(extractCssModuleClasses(`styles.valid; styles['_ok']; styles['is-active'];
      styles['9bad']; styles['bad space']; styles['$bad']; styles['bad;body{}'];
      styles[name]; styles['prefix' + suffix];`, 'styles')).toEqual(['_ok', 'is-active', 'valid']);
  });

  it('skips parse-invalid files without hiding valid consumers in other files', () => {
    const files = {
      'src/broken.tsx': `import broken from './shared.module.css'; broken.wrong; const nope = ;`,
      'src/good.tsx': `import valid from './shared.module.css'; valid.right;`,
    };
    expect(generateMissingCssModules(files)[0].classes).toEqual(['right']);
    expect(extractCssModuleClasses(`styles.wrong; const nope = ;`, 'styles')).toEqual([]);
  });

  it('recognizes real imports with comments between tokens', () => {
    const files = { 'src/a.tsx': `import /* binding */ styles /* source */ from './shared.module.css'; styles.card;` };
    expect(generateMissingCssModules(files)[0].classes).toEqual(['card']);
  });

  it.each(['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs', 'cts', 'cjs'])('uses the shared source extension convention for .%s', (ext) => {
    expect(generateMissingCssModules({ [`src/a.${ext}`]: `import s from './shared.module.css'; s.card;` })[0]?.classes).toEqual(['card']);
  });

  it('preserves existing stylesheets and all inputs across multiple consumers', () => {
    const files = Object.freeze({ ...consumers, 'src/shared.module.css': '.untouched { color: red; }' });
    const before = JSON.stringify(files);
    expect(generateMissingCssModules(files)).toEqual([]);
    expect(JSON.stringify(files)).toBe(before);
  });

  it('does not manufacture targets for package, absolute, alias, side-effect, type-only or non-code imports', () => {
    const files = {
      'src/a.tsx': `import pkg from 'package/shared.module.css'; pkg.card;
        import absolute from '/shared.module.css'; absolute.card;
        import alias from '@/shared.module.css'; alias.card;
        import type types from './types.module.css';
        import './side-effect.module.css';
        import * as namespace from './namespace.module.css'; namespace.card;
        import { named } from './named.module.css'; named.card;`,
      'README.md': `import s from './docs.module.css'; s.card;`,
    };
    expect(generateMissingCssModules(files)).toEqual([]);
  });

  it('does not merge separate missing targets with the same basename', () => {
    const files = {
      'src/a.tsx': `import s from './shared.module.css'; s.one;`,
      'src/nested/b.tsx': `import s from './shared.module.css'; s.two;`,
    };
    expect(generateMissingCssModules(files).map(s => [s.path, s.classes])).toEqual([
      ['src/shared.module.css', ['one']], ['src/nested/shared.module.css', ['two']],
    ]);
  });
});


describe('CSS module presence metadata stays separate from source evidence', () => {
  it('never generates a stylesheet already present only in the supplied path list', () => {
    const files = Object.freeze({ 'src/a.tsx': `import s from './existing.module.css'; s.card;` });
    const existingPaths = Object.freeze(['src/existing.module.css']);
    expect(generateMissingCssModules(files, existingPaths)).toEqual([]);
    expect(files).toEqual({ 'src/a.tsx': `import s from './existing.module.css'; s.card;` });
    expect(existingPaths).toEqual(['src/existing.module.css']);
  });

  it('does not infer source reads from unrelated existing paths', () => {
    const files = { 'src/a.tsx': `import s from './missing.module.css'; s.card;` };
    const stubs = generateMissingCssModules(files, ['src/unread.tsx', 'src/other.module.css']);
    expect(stubs.map(s => [s.path, s.classes])).toEqual([['src/missing.module.css', ['card']]]);
  });
});
