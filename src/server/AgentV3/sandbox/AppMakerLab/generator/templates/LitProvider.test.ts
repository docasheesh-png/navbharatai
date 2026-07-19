import { describe, it, expect } from 'vitest';
import { LitProvider } from './LitProvider';
import { TemplateRegistry } from './TemplateRegistry';
import { detectFrameworkFromPrompt } from '../../../../PromptFramework';
import { FRAMEWORKS } from '../../../../FrameworkRegistry';

describe('LitProvider — a real, boot-clean Lit + Vite Web Components scaffold', () => {
  const files = new LitProvider().getFiles([]);

  it('emits the expected files with the custom element mounted in index.html', () => {
    expect(Object.keys(files).sort()).toEqual(
      ['index.html', 'package.json', 'src/main.ts', 'src/my-app.ts', 'tsconfig.json', 'vite.config.ts'].sort(),
    );
    expect(files['index.html']).toContain('<my-app></my-app>');
    expect(files['index.html']).toContain('/src/main.ts');
  });

  it('wires Lit correctly (lit dep, decorator tsconfig, no framework plugin needed)', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies.lit).toBeDefined();
    const tsc = JSON.parse(files['tsconfig.json']).compilerOptions;
    // Lit's decorators require the legacy semantics + fields not define-initialized.
    expect(tsc.experimentalDecorators).toBe(true);
    expect(tsc.useDefineForClassFields).toBe(false);
    expect(files['vite.config.ts']).not.toContain('plugins: ['); // Lit needs no Vite plugin array
  });

  it('defines a real LitElement with @customElement + reactive @state', () => {
    expect(files['src/my-app.ts']).toContain("from 'lit'");
    expect(files['src/my-app.ts']).toContain("@customElement('my-app')");
    expect(files['src/my-app.ts']).toContain('@state()');
    expect(files['src/main.ts']).toContain("import './my-app'"); // registers the element
  });
});

describe('Lit is fully wired — and NEVER false-positives on the common word "lit"', () => {
  it('TemplateRegistry resolves the "lit" key to a LitProvider', () => {
    expect(new TemplateRegistry().getProvider('lit')).toBeInstanceOf(LitProvider);
  });

  it('detects real Lit / web-component requests', () => {
    expect(detectFrameworkFromPrompt('build a LitElement counter')).toBe('lit');
    expect(detectFrameworkFromPrompt('a web components dashboard')).toBe('lit');
    expect(detectFrameworkFromPrompt('use lit-html for this')).toBe('lit');
  });

  it('bare "lit" (common English) does NOT map to the Lit scaffold', () => {
    expect(detectFrameworkFromPrompt('build a lit party planner app')).not.toBe('lit');
    expect(detectFrameworkFromPrompt('a well-lit room booking app')).not.toBe('lit');
  });

  it('appears in the FrameworkRegistry', () => {
    const lit = FRAMEWORKS.find((f) => f.id === 'lit');
    expect(lit).toBeDefined();
    expect(lit?.category).toBe('frontend');
  });
});
