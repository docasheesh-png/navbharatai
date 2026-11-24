/**
 * Q-2768 (BR2002 D3+D4): the fast lane saved 8 of its 12 planned files and handed them off; one imported
 * `./ServicesSection.css`, planned and never written. The hand-off did not name it, the hand-off typecheck cannot see a
 * stylesheet, and the app did not render for ~40 s. Class: the hand-off named what exists, never what the saved work
 * NEEDS that does not exist. Fixtures follow the report's shape (synthetic contents, the report's file names).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadedRelativeSpecifiers, missingImportsHandoffLine, missingImportsOfSaved, savedWorkMissingLine } from '../src/server/AgentV3/salvageMissingImports';
import { steeringSalvage, STEERING_YIELD_REASON } from '../src/server/AgentV3/steeringHandoff';

const SAVED: Record<string, string> = {
  'src/App.tsx': "import './index.css';\nimport ServicesSection from './components/ServicesSection';\nexport default function App() { return <ServicesSection />; }\n",
  'src/components/ServicesSection.tsx': "import './ServicesSection.css';\nimport { SERVICES } from '../data/services';\nexport default function ServicesSection() { return <ul>{SERVICES.map((s) => <li key={s}>{s}</li>)}</ul>; }\n",
  'src/data/services.ts': "export const SERVICES = ['Plumbing', 'Wiring'];\n",
};
const STARTER = new Set(['src/index.css', 'src/main.tsx', 'index.html']);

describe('the hand-off names a file the saved work imports and nobody wrote', () => {
  it('🔴 the report: ServicesSection.css is named, the starter stylesheet on disk is not, a saved module is not', async () => {
    const reads: string[] = [];
    const missing = await missingImportsOfSaved(SAVED, (p) => p in SAVED, async (p) => { reads.push(p); return STARTER.has(p); });
    expect(missing).toEqual([{ path: 'src/components/ServicesSection.css', importedBy: 'src/components/ServicesSection.tsx' }]);
    expect(reads).toContain('src/index.css');
    const line = missingImportsHandoffLine(missing);
    expect(line).toMatch(/src\/components\/ServicesSection\.css \(imported by src\/components\/ServicesSection\.tsx\)/);
    expect(line).toMatch(/write each one FIRST/);
  });

  it('every way a file loads another is read; a commented-out import is not', () => {
    const src = [
      "import './a.css';",
      "import X from './b';",
      "import type { T } from '../c';",
      "export { d } from './d';",
      "const E = lazy(() => import('./e'));",
      "import logo from './logo.svg?react';",
      "// import './old.css';",
      "/* import Gone from './gone'; */",
      "import React from 'react';",
    ].join('\n');
    expect(loadedRelativeSpecifiers(src).sort()).toEqual(['../c', './a.css', './b', './d', './e', './logo.svg?react']);
  });

  it('nothing missing ⇒ nothing said; a failing sandbox names nothing it did not prove; reads are bounded', async () => {
    expect(missingImportsHandoffLine(await missingImportsOfSaved(SAVED, () => true, async () => false))).toBe('');
    expect(await missingImportsOfSaved(SAVED, () => false, async () => { throw new Error('sandbox gone'); }, 12, 0)).toEqual([]);
    let n = 0;
    await missingImportsOfSaved(SAVED, () => false, async () => { n++; return false; }, 12, 5);
    expect(n).toBe(5);
  });

  it('🔒 wired into the salvage hand-off', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    const at = route.indexOf('salvageQualityNotes(Object.fromEntries(writtenFiles), sb.salvagedPaths) +');
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at, at + 700)).toContain('await savedWorkMissingLine(sb.salvagedPaths, writtenFiles, projectFilesAtTurnStart,');
    // the sibling door: the one-shot's scope-change hand-off
    expect(route).toContain('await savedWorkMissingLine(os.salvagedPaths, writtenFiles, projectFilesAtTurnStart,');
  });
});

describe('the one call both hand-off doors make', () => {
  it('reads the saved paths from the turn, and the one-shot hand-off carries the line', async () => {
    const written = new Map(Object.entries(SAVED));
    const line = await savedWorkMissingLine(Object.keys(SAVED), written, { 'src/index.css': 'body{}' }, async (p) => { if (!STARTER.has(p)) throw new Error('ENOENT'); });
    expect(line).toMatch(/ServicesSection\.css/);
    expect(line).not.toMatch(/index\.css/);
    const prompt = steeringSalvage({ ok: false, reason: STEERING_YIELD_REASON, salvagedPaths: Object.keys(SAVED) }, 'NEXT', () => {}, line);
    expect(prompt).toContain('ServicesSection.css (imported by src/components/ServicesSection.tsx)');
    expect(prompt.endsWith('NEXT')).toBe(true);
    // without a line the hand-off is exactly as before
    expect(steeringSalvage({ ok: false, reason: STEERING_YIELD_REASON, salvagedPaths: ['a.ts'] }, 'NEXT', () => {})).not.toContain('IMPORTED by');
  });
  it('a slow sandbox never holds the build up; nothing saved says nothing', async () => {
    const written = new Map(Object.entries(SAVED));
    const t = Date.now();
    expect(await savedWorkMissingLine(Object.keys(SAVED), written, null, () => new Promise(() => {}), 50)).toBe('');
    expect(Date.now() - t).toBeLessThan(2000);
    expect(await savedWorkMissingLine([], written, null, async () => true)).toBe('');
  });
});
