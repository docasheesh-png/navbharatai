import { describe, it, expect } from 'vitest';
import { scaffoldMissingUiPrimitives, isScaffoldablePrimitive } from './uiPrimitiveScaffold';
import { findSyntaxErrors } from '../AgentV3/SyntaxCheck';
import { preflightVerify, preflightAndHeal } from './mobileShipPreflight';

describe('uiPrimitiveScaffold — detection', () => {
  it('recognises the scaffoldable specifiers', () => {
    expect(isScaffoldablePrimitive('@/components/ui/button')).toBe(true);
    expect(isScaffoldablePrimitive('@/components/ui/card')).toBe(true);
    expect(isScaffoldablePrimitive('@/lib/utils')).toBe(true);
    expect(isScaffoldablePrimitive('~/components/ui/input')).toBe(true);
  });
  it('ignores unknown / non-primitive specifiers', () => {
    expect(isScaffoldablePrimitive('@/components/ui/some-bespoke-thing')).toBe(false);
    expect(isScaffoldablePrimitive('@/components/Header')).toBe(false);
    expect(isScaffoldablePrimitive('react')).toBe(false);
    expect(isScaffoldablePrimitive('./local')).toBe(false);
  });
});

describe('uiPrimitiveScaffold — creation', () => {
  it('creates the primitive + cn helper at the app\'s real client/src root', () => {
    const { files, created } = scaffoldMissingUiPrimitives({}, [
      { path: 'client/src/components/BackButton.tsx', spec: '@/components/ui/button' },
    ]);
    expect(files['client/src/components/ui/button.tsx']).toContain('export { Button');
    expect(files['client/src/lib/utils.ts']).toContain('export function cn');
    expect(created).toContain('button');
  });

  it('does not overwrite a primitive the app already has', () => {
    const existing = { 'src/components/ui/button.tsx': 'export const Button = () => null;' };
    const { files } = scaffoldMissingUiPrimitives(existing, [
      { path: 'src/App.tsx', spec: '@/components/ui/button' },
    ]);
    expect(files['src/components/ui/button.tsx']).toBeUndefined(); // untouched
  });

  it('only touches known primitives, leaving genuinely-missing components for the AI pass', () => {
    const { files } = scaffoldMissingUiPrimitives({}, [
      { path: 'src/App.tsx', spec: '@/components/Header' }, // a bespoke component — not ours to invent
    ]);
    expect(Object.keys(files)).toHaveLength(0);
  });
});

describe('uiPrimitiveScaffold — EVERY generated file compiles (esbuild parse)', () => {
  it('all primitives + cn parse with zero syntax errors', async () => {
    // Ask for one of each known primitive from a client/src app, then esbuild-parse them all.
    const specs = ['button', 'input', 'textarea', 'label', 'card', 'badge', 'separator', 'skeleton', 'alert', 'avatar', 'switch', 'checkbox', 'progress']
      .map((n) => ({ path: 'client/src/App.tsx', spec: `@/components/ui/${n}` }));
    const { files } = scaffoldMissingUiPrimitives({}, specs);
    expect(Object.keys(files).length).toBeGreaterThan(10);
    const errs = await findSyntaxErrors(files);
    expect(errs).toEqual([]); // every scaffolded component is valid TSX
  });
});

describe('preflightAndHeal — heals a "missing @/components/ui/*" app with NO AI (deterministic)', () => {
  it('creates the primitives, adds their deps, and the app then compiles', async () => {
    const app: Record<string, string> = {
      'package.json': JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { vite: '^5.0.0' } }),
      'index.html': '<div id="root"></div>',
      'client/src/main.tsx': "import { App } from './App';\nexport const boot = () => App;",
      'client/src/App.tsx': "import { Button } from '@/components/ui/button';\nimport { Card } from '@/components/ui/card';\nexport const App = () => [Button, Card];",
    };
    // Before: it does not compile (button, card, and their cn helper are missing).
    expect((await preflightVerify(app)).ok).toBe(false);

    // chain=[] means the AI pass is skipped — so a green result PROVES the deterministic tiers did it.
    const healed = await preflightAndHeal(app, {} as any, [], 0);
    expect(healed.ok).toBe(true);
    expect(healed.aiRounds).toBe(0);
    expect(healed.files['client/src/components/ui/button.tsx']).toContain('Button');
    expect(healed.files['client/src/components/ui/card.tsx']).toContain('Card');
    expect(healed.files['client/src/lib/utils.ts']).toContain('cn');
    // Their deps were added deterministically.
    const pkg = JSON.parse(healed.files['package.json']);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(allDeps.clsx).toBeTruthy();
    expect(allDeps['tailwind-merge']).toBeTruthy();
    expect(allDeps['class-variance-authority']).toBeTruthy();
  });
});
