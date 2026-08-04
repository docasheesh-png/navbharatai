import { describe, it, expect } from 'vitest';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles, goldenScaffoldForPrompt } from './registry';
import { STARTER_TEMPLATES } from '../../../components/agentv3/starterTemplates';
import { findSyntaxErrors } from '../SyntaxCheck';
import { checkPreviewCompiles } from '../../runtime/PreviewCompileCheck';
import { dedupeSameModuleImports } from '../FullStackGuards';

const SIMPLE = STARTER_TEMPLATES.filter((t) => t.tier === 'simple');
const PRO = STARTER_TEMPLATES.filter((t) => t.tier === 'pro');
/** Pro chips that ship a scaffold today. The rest fall through to a normal build — see the test below. */
const PRO_WITH_SCAFFOLD = GOLDEN_SCAFFOLDS.filter((g) => g.tier === 'pro').map((g) => g.id);

describe('golden scaffolds — every simple starter chip ships a hand-verified, compiling app', () => {
  it('EVERY simple chip still has a scaffold — the free tier\'s first build must never regress', () => {
    const simpleScaffolds = GOLDEN_SCAFFOLDS.filter((g) => g.tier === 'simple').map((g) => g.id).sort();
    expect(simpleScaffolds).toEqual(SIMPLE.map((t) => t.id).sort());
  });

  it('every scaffold id is a REAL chip id, and its tier matches that chip', () => {
    for (const g of GOLDEN_SCAFFOLDS) {
      const chip = STARTER_TEMPLATES.find((t) => t.id === g.id);
      expect(chip, g.id + ' is not a starter chip').toBeTruthy();
      expect(chip!.tier, g.id + ' tier mismatch').toBe(g.tier);
    }
  });

  for (const g of GOLDEN_SCAFFOLDS) {
    describe(g.label, () => {
      const files = goldenScaffoldFiles(g);

      it('ships the full runnable vite-react file set (platform-scaffold shape)', () => {
        for (const req of [
          'package.json', 'vite.config.ts', 'tsconfig.json', 'index.html',
          'src/main.tsx', 'src/App.tsx', 'src/ErrorBoundary.tsx', 'src/index.css', 'src/theme.tsx',
          // A pro scaffold is an ARCHITECTURE, so its shared foundation must be there or App.tsx's
          // imports dangle and the very first preview white-screens.
          ...(g.tier === 'pro' ? ['src/lib/ui.tsx', 'src/lib/store.ts'] : []),
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

  it('a pro chip WITH a scaffold matches it', () => {
    for (const id of PRO_WITH_SCAFFOLD) {
      const chip = PRO.find((t) => t.id === id)!;
      expect(goldenScaffoldForPrompt(chip.prompt)?.id, id).toBe(id);
    }
  });

  it('EVERY showcase chip has a scaffold — these are the apps a user is shown FIRST', () => {
    // A showcase chip is someone's first impression of NavBharatAI. Adding one without a scaffold
    // would quietly send the most-seen builds back to building from nothing, so this fails CI instead.
    const showcase = STARTER_TEMPLATES.filter((t) => t.showcase).map((t) => t.id).sort();
    const scaffolded = GOLDEN_SCAFFOLDS.map((g) => g.id);
    for (const id of showcase) {
      expect(scaffolded, id + ' is a showcase chip with no golden scaffold').toContain(id);
    }
    expect(showcase.length).toBeGreaterThan(0);
  });

  it('a pro chip WITHOUT a scaffold still falls through to a normal build — never a wrong template', () => {
    for (const t of PRO.filter((x) => !PRO_WITH_SCAFFOLD.includes(x.id))) {
      expect(goldenScaffoldForPrompt(t.prompt), t.id).toBeNull();
    }
  });
});

describe('PRO scaffolds are an architecture, not a finished app', () => {
  const PRO_SCAFFOLDS = GOLDEN_SCAFFOLDS.filter((g) => g.tier === 'pro');

  it('there are pro scaffolds to check', () => {
    expect(PRO_SCAFFOLDS.length).toBeGreaterThan(0);
  });

  for (const g of PRO_SCAFFOLDS) {
    describe(g.label, () => {
      const files = goldenScaffoldFiles(g);

      it('splits into small, single-purpose files — never one monolith', () => {
        // The edit-resilience rule the system prompt demands of every build, handed over already correct.
        expect(Object.keys(files)).toContain('src/lib/ui.tsx');
        expect(Object.keys(files)).toContain('src/lib/store.ts');
        // A pro App.tsx that swallowed the whole app would defeat the point.
        expect(files['src/App.tsx'].length).toBeLessThan(24000);
      });

      it('actually USES the shared foundation rather than duplicating it', () => {
        const app = files['src/App.tsx'];
        expect(app).toMatch(/from '\.\/lib\/ui'/);
        expect(app).toMatch(/from '\.\/lib\/store'/);
        // Re-declaring a shared component locally is the drift this foundation exists to prevent.
        expect(app).not.toMatch(/^(export )?function (Shell|Card|Badge|Modal)\(/m);
      });

      it('persists its data — a first build whose data vanishes on reload reads as broken', () => {
        expect(files['src/App.tsx']).toMatch(/useCollection</);
        expect(files['src/lib/store.ts']).toMatch(/localStorage\.setItem/);
      });

      it('survives a corrupted or unavailable localStorage without white-screening', () => {
        // A throw during render takes the whole app down; the store must fall back to its seed.
        expect(files['src/lib/store.ts']).toMatch(/catch\s*{/);
        expect(files['src/lib/store.ts']).toMatch(/return seed/);
      });

      it('has a default export App, so main.tsx can mount it', () => {
        expect(files['src/App.tsx']).toMatch(/export default function App\(/);
      });
    });
  }
});
