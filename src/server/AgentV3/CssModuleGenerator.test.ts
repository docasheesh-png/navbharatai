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
