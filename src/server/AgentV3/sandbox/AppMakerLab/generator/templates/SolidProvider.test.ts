import { describe, it, expect } from 'vitest';
import { SolidProvider } from './SolidProvider';
import { TemplateRegistry } from './TemplateRegistry';
import { detectFrameworkFromPrompt } from '../../../../PromptFramework';
import { FRAMEWORKS } from '../../../../FrameworkRegistry';

describe('SolidProvider — a real, boot-clean SolidJS + Vite scaffold', () => {
  const files = new SolidProvider().getFiles([]);

  it('emits one Solid entry point (no React files, no second entry)', () => {
    expect(Object.keys(files).sort()).toEqual(
      ['index.html', 'package.json', 'src/index.css', 'src/App.tsx', 'src/index.tsx', 'tsconfig.json', 'vite.config.ts'].sort(),
    );
    expect(files['src/main.tsx']).toBeUndefined(); // must not collide with the React scaffold's entry
    expect(files['index.html']).toContain('/src/index.tsx');
    expect(files['index.html']).toContain('id="root"');
  });

  it('wires the Solid toolchain correctly (solid-js, vite-plugin-solid, jsxImportSource)', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBe('module'); // vite-plugin-solid is ESM-only
    expect(pkg.dependencies['solid-js']).toBeDefined();
    expect(pkg.devDependencies['vite-plugin-solid']).toBeDefined();
    expect(files['vite.config.ts']).toContain("import solid from 'vite-plugin-solid'");
    expect(files['vite.config.ts']).toContain('plugins: [solid()]');
    expect(JSON.parse(files['tsconfig.json']).compilerOptions.jsxImportSource).toBe('solid-js');
  });

  it('renders via solid-js/web with a null-safe mount', () => {
    expect(files['src/index.tsx']).toContain("import { render } from 'solid-js/web'");
    expect(files['src/index.tsx']).toContain('if (root)');
    expect(files['src/App.tsx']).toContain("from 'solid-js'");
    expect(files['src/App.tsx']).toContain('createSignal');
  });
});

describe('SolidJS is fully wired (registry + prompt detection + framework registry)', () => {
  it('TemplateRegistry resolves the "solid" key to a SolidProvider', () => {
    expect(new TemplateRegistry().getProvider('solid')).toBeInstanceOf(SolidProvider);
  });

  it('detectFrameworkFromPrompt maps an explicit SolidJS request to "solid"', () => {
    expect(detectFrameworkFromPrompt('build a solidjs todo app')).toBe('solid');
    expect(detectFrameworkFromPrompt('a Solid.js dashboard')).toBe('solid');
    expect(detectFrameworkFromPrompt('make it with solid js')).toBe('solid');
  });

  it('bare "solid" (common English) does NOT false-positive onto the Solid scaffold', () => {
    expect(detectFrameworkFromPrompt('build a solid, reliable gym app')).not.toBe('solid');
    expect(detectFrameworkFromPrompt('a rock-solid todo list')).not.toBe('solid');
  });

  it('appears in the FrameworkRegistry (so the picker + dev-server know it)', () => {
    const solid = FRAMEWORKS.find((f) => f.id === 'solid');
    expect(solid).toBeDefined();
    expect(solid?.category).toBe('frontend');
    expect(solid?.devPort).toBe(5173);
  });
});
