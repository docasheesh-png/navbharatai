import { describe, it, expect } from 'vitest';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles, goldenScaffoldForPrompt } from './registry';
import { STARTER_TEMPLATES } from '../../../components/agentv3/starterTemplates';
import { findSyntaxErrors } from '../SyntaxCheck';
import { checkPreviewCompiles } from '../../runtime/PreviewCompileCheck';
import { dedupeSameModuleImports } from '../FullStackGuards';

const SIMPLE = STARTER_TEMPLATES.filter((t) => t.tier === 'simple');

describe('golden scaffolds — every simple starter chip ships a hand-verified, compiling app', () => {
  it('stays in LOCKSTEP with STARTER_TEMPLATES: every simple chip has a scaffold, and nothing extra', () => {
    expect(GOLDEN_SCAFFOLDS.map((g) => g.id).sort()).toEqual(SIMPLE.map((t) => t.id).sort());
  });

  for (const g of GOLDEN_SCAFFOLDS) {
    describe(g.label, () => {
      const files = goldenScaffoldFiles(g);

      it('ships the full runnable vite-react file set (platform-scaffold shape)', () => {
        for (const req of [
          'package.json', 'vite.config.ts', 'tsconfig.json', 'index.html',
          'src/main.tsx', 'src/App.tsx', 'src/ErrorBoundary.tsx', 'src/index.css', 'src/theme.tsx',
        ]) {
          expect(Object.keys(files), req).toContain(req);
        }
        expect(() => JSON.parse(files['package.json'])).not.toThrow();
        expect(files['index.html']).toContain('<title>' + g.title + '</title>');
      });

      it('parses clean under esbuild (the vite build parser)', async () => {
        expect(await findSyntaxErrors(files)).toEqual([]);
      });

      it('compiles clean under the in-browser Babel preview (the white-screen killer proof)', () => {
        const pc = checkPreviewCompiles(files);
        expect(pc.errors).toEqual([]);
        expect(pc.ok).toBe(true);
        expect(pc.checked).toBeGreaterThanOrEqual(4); // main/App/ErrorBoundary/theme all really checked
      });

      it('has ZERO duplicate same-module imports (the recurring ErrorBoundary class, by construction)', () => {
        for (const [p, c] of Object.entries(files)) {
          if (/[.](tsx?|jsx?)$/.test(p)) expect(dedupeSameModuleImports(p, c), p).toBe(c);
        }
      });

      it('is white-label and secret-free', () => {
        const blob = Object.values(files).join('\n').toLowerCase();
        for (const vendor of ['anthropic', 'claude', 'openai', 'gemini', 'moonshot', 'kimi', 'glm-', 'z.ai', 'grok', 'pollinations']) {
          expect(blob, vendor).not.toContain(vendor);
        }
        expect(blob).not.toMatch(/(api[_-]?key|secret)\s*[:=]\s*['"][a-z0-9]{8,}/i);
      });
    });
  }
});

describe('goldenScaffoldForPrompt — exact chip prompts match, edited prompts build normally', () => {
  it('matches EVERY simple chip prompt to its own scaffold', () => {
    for (const t of SIMPLE) {
      expect(goldenScaffoldForPrompt(t.prompt)?.id, t.id).toBe(t.id);
    }
  });

  it('tolerates surrounding whitespace and trailing punctuation only', () => {
    const t = SIMPLE[0];
    expect(goldenScaffoldForPrompt('  ' + t.prompt + ' . ')?.id).toBe(t.id);
    expect(goldenScaffoldForPrompt(t.prompt.toUpperCase())?.id).toBe(t.id);
  });

  it('an EDITED prompt gets a normal from-scratch build (null) — never a surprise template', () => {
    expect(goldenScaffoldForPrompt(SIMPLE[0].prompt + ' but with cloud sync')).toBeNull();
    expect(goldenScaffoldForPrompt('build me a todo app')).toBeNull();
    expect(goldenScaffoldForPrompt('')).toBeNull();
  });

  it('pro-tier chip prompts never match (no golden scaffold exists for them yet)', () => {
    for (const t of STARTER_TEMPLATES.filter((x) => x.tier === 'pro')) {
      expect(goldenScaffoldForPrompt(t.prompt), t.id).toBeNull();
    }
  });
});
