import { describe, it, expect } from 'vitest';
import { AlpineProvider } from './AlpineProvider';
import { TemplateRegistry } from './TemplateRegistry';
import { detectFrameworkFromPrompt } from '../../../../PromptFramework';
import { FRAMEWORKS } from '../../../../FrameworkRegistry';

describe('AlpineProvider — a real, boot-clean Alpine.js + Vite scaffold', () => {
  const files = new AlpineProvider().getFiles([]);

  it('emits the expected files with Alpine directives in index.html', () => {
    expect(Object.keys(files).sort()).toEqual(
      ['index.html', 'package.json', 'src/main.ts', 'tsconfig.json', 'vite.config.ts'].sort(),
    );
    expect(files['index.html']).toContain('x-data="{ count: 0 }"');
    expect(files['index.html']).toContain('x-text="count"');
    expect(files['index.html']).toContain('@click="count++"');
  });

  it('imports and starts Alpine (so the x-* directives become reactive)', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies.alpinejs).toBeDefined();
    expect(files['src/main.ts']).toContain("import Alpine from 'alpinejs'");
    expect(files['src/main.ts']).toContain('Alpine.start()');
    expect(files['vite.config.ts']).not.toContain('plugins: ['); // no plugin needed
  });
});

describe('Alpine is fully wired (registry + prompt detection + framework registry)', () => {
  it('TemplateRegistry resolves the "alpine" key to an AlpineProvider', () => {
    expect(new TemplateRegistry().getProvider('alpine')).toBeInstanceOf(AlpineProvider);
  });

  it('detectFrameworkFromPrompt maps an explicit Alpine request to "alpine"', () => {
    expect(detectFrameworkFromPrompt('build an alpine.js landing page')).toBe('alpine');
    expect(detectFrameworkFromPrompt('a lightweight AlpineJS widget')).toBe('alpine');
  });

  it('appears in the FrameworkRegistry', () => {
    const alpine = FRAMEWORKS.find((f) => f.id === 'alpine');
    expect(alpine).toBeDefined();
    expect(alpine?.category).toBe('frontend');
  });
});
