import { describe, it, expect } from 'vitest';
import { PreactProvider } from './PreactProvider';
import { TemplateRegistry } from './TemplateRegistry';
import { detectFrameworkFromPrompt } from '../../../../PromptFramework';
import { FRAMEWORKS } from '../../../../FrameworkRegistry';

describe('PreactProvider — a real, boot-clean Preact + Vite scaffold', () => {
  const files = new PreactProvider().getFiles([]);

  it('emits the expected files with one entry point', () => {
    expect(Object.keys(files).sort()).toEqual(
      ['index.html', 'package.json', 'src/index.css', 'src/app.tsx', 'src/main.tsx', 'tsconfig.json', 'vite.config.ts'].sort(),
    );
    expect(files['index.html']).toContain('/src/main.tsx');
    expect(files['index.html']).toContain('id="app"');
  });

  it('wires the Preact toolchain correctly (preact, @preact/preset-vite, jsxImportSource)', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBe('module'); // preset-vite is ESM-only
    expect(pkg.dependencies.preact).toBeDefined();
    expect(pkg.devDependencies['@preact/preset-vite']).toBeDefined();
    expect(files['vite.config.ts']).toContain("import preact from '@preact/preset-vite'");
    expect(files['vite.config.ts']).toContain('plugins: [preact()]');
    expect(JSON.parse(files['tsconfig.json']).compilerOptions.jsxImportSource).toBe('preact');
  });

  it('renders via preact with a null-safe mount and preact/hooks', () => {
    expect(files['src/main.tsx']).toContain("import { render } from 'preact'");
    expect(files['src/main.tsx']).toContain('if (root)');
    expect(files['src/app.tsx']).toContain("from 'preact/hooks'");
    expect(files['src/app.tsx']).toContain('useState');
  });
});

describe('Preact is fully wired (registry + prompt detection + framework registry)', () => {
  it('TemplateRegistry resolves the "preact" key to a PreactProvider', () => {
    expect(new TemplateRegistry().getProvider('preact')).toBeInstanceOf(PreactProvider);
  });

  it('detectFrameworkFromPrompt maps an explicit Preact request to "preact" (checked before React)', () => {
    expect(detectFrameworkFromPrompt('build a preact todo app')).toBe('preact');
    expect(detectFrameworkFromPrompt('a lightweight PreactJS dashboard')).toBe('preact');
  });

  it('appears in the FrameworkRegistry (so the picker + dev-server know it)', () => {
    const preact = FRAMEWORKS.find((f) => f.id === 'preact');
    expect(preact).toBeDefined();
    expect(preact?.category).toBe('frontend');
    expect(preact?.devPort).toBe(5173);
  });
});
