// AUTOPSY c847b523 (2026-09-20) — our own starter apps failed our own accessibility gate.
//
// The build report carried 39 `control-unlabeled` findings, every one of them against a GOLDEN
// SCAFFOLD: a hand-written, CI-proven starter app that NavBharatAI pre-seeds before the model writes
// a line. So the very first thing a user's app inherited from us was a screen a blind user cannot
// fill in — and the engine then spent its own turns being told about defects it had not caused.
//
// 🔑 THE 50/50 LAW, applied literally. The first half was the analyzer, which was lying about 20 of
// the 39 (see AccessibilityAnalysis.test.ts). The other half is THIS: why did the problem arise at
// all? Because nothing ever ran the production gate over the templates the gate would later judge.
// The scaffolds have had a CI lock for parsing, for Babel compilation and for duplicate imports since
// the white-screen work — accessibility was simply never one of the things asked.
//
// 🔒 So the fix is not 19 aria-labels; it is that a new template with an unlabelled control can no
// longer reach `main`. This runs the REAL `scanAccessibility` — the same function, not a copy of its
// rules — over every registered scaffold. A copy would drift; asking the production module cannot.

import { describe, it, expect } from 'vitest';
import { scanAccessibility } from '../src/server/AgentV3/AccessibilityAnalysis';
import { GOLDEN_SCAFFOLDS } from '../src/server/AgentV3/goldenScaffolds/registry';

/** What the gate says about one scaffold's App.tsx, as `id: kind — snippet` lines. */
function findingsFor(id: string, appTsx: string): string[] {
  return scanAccessibility('src/App.tsx', appTsx).map(
    (i) => `${id}: ${i.kind} — ${i.snippet.replace(/\s+/g, ' ').slice(0, 100)}`,
  );
}

describe('every golden scaffold passes the gate its own apps are judged by', () => {
  it('has scaffolds to check at all', () => {
    // Guards the whole file: an empty registry would make every assertion below vacuously true.
    expect(GOLDEN_SCAFFOLDS.length).toBeGreaterThan(5);
  });

  it('🔒 not one control in any scaffold is unlabelled', () => {
    const bad = GOLDEN_SCAFFOLDS.flatMap((s) =>
      findingsFor(s.id, s.appTsx).filter((l) => l.includes('control-unlabeled')),
    );
    // The message IS the fix instruction: it names the app and prints the control's own markup.
    expect(bad, `Add an aria-label (or a wrapping <label>) to:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔒 and no scaffold ships a HIGH-severity accessibility defect', () => {
    // High severity is the set a user would meet as a broken screen — a picture with no alt text, an
    // image button that announces nothing. Widened deliberately beyond the finding that was reported,
    // per rule 3: the same blind spot that hid labels hid these too.
    const high = GOLDEN_SCAFFOLDS.flatMap((s) =>
      scanAccessibility('src/App.tsx', s.appTsx)
        .filter((i) => i.severity === 'high')
        .map((i) => `${s.id}: ${i.kind} — ${i.snippet.replace(/\s+/g, ' ').slice(0, 100)}`),
    );
    expect(high, `Fix in the scaffold source:\n${high.join('\n')}`).toEqual([]);
  });

  it('⚠️ the check is really running — a deliberately broken template is caught', () => {
    // Without this, a scanner that silently returned [] (a bad path filter, a thrown-and-swallowed
    // parse) would make the two locks above pass for ever while proving nothing.
    const broken = 'export default function App() {\n  return <select value={x} onChange={(e) => set(e)}></select>;\n}';
    expect(findingsFor('fake', broken).some((l) => l.includes('control-unlabeled'))).toBe(true);
  });
});
