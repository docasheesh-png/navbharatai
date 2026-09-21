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
//
// 🔴 AND THAT PROMISE WAS NOT KEPT FOR ONE DAY (autopsy 8a92e5ed, 2026-09-20). The very next report
// told a free user their working password generator had *"3 form field(s) with no label"*. This file
// was green throughout — because **`scanAccessibility` is not what writes the `ACCESSIBILITY` line in
// a build report.** `AppMakerLab/intelligence/A11yLinter.ts` is, by way of `buildQualityLint.ts`, and
// nothing had ever pointed a lock at it. The instance was fixed and the sibling was never hunted; the
// lock was aimed at the analyzer that does not judge builds.
//
// So both are asked here now, and the second one found ELEVEN genuinely unlabelled controls the first
// cannot see: `scanAccessibility` reads a tag only when it CLOSES ON ITS OWN LINE, and a generated
// React input is routinely written over six. `<label>Email</label>` beside an `<input>` with no
// `htmlFor`/`id` is not a label to a screen reader, and NavBharatAI's login template shipped three of
// them. A `placeholder` is not one either — it vanishes the moment the user types.

import { describe, it, expect } from 'vitest';
import { scanAccessibility } from '../src/server/AgentV3/AccessibilityAnalysis';
import { lintA11y } from '../src/server/AppMakerLab/intelligence/A11yLinter';
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

  it('🔒 the linter that writes the BUILD REPORT is clean on every scaffold too', () => {
    // THE SIBLING. `buildQualityLint.ts` → `lintA11y` is what produced the false finding in autopsy
    // 8a92e5ed and what produces every real one. Asking only `scanAccessibility` above left this
    // module — the one a user actually meets — locked by nothing at all.
    const bad = GOLDEN_SCAFFOLDS.flatMap((s) =>
      lintA11y(s.appTsx).violations
        .filter((v) => v.severity === 'warn')
        .map((v) => `${s.id}: ${v.type} ×${v.count} — ${v.message}`),
    );
    expect(bad, `The build report's own linter would flag these:\n${bad.join('\n')}`).toEqual([]);
  });

  it('⚠️ and THAT check is really running — a deliberately broken template is caught', () => {
    // The same canary as below, for the second linter: a rule that silently counted nothing would
    // make the lock above pass for ever while proving nothing.
    const broken = 'export default function App() {\n  return (\n    <input\n      value={x}\n      onChange={(e) => set(e.target.value)}\n    />\n  );\n}';
    expect(lintA11y(broken).violations.some((v) => v.type === 'input-label')).toBe(true);
  });

  it('⚠️ the check is really running — a deliberately broken template is caught', () => {
    // Without this, a scanner that silently returned [] (a bad path filter, a thrown-and-swallowed
    // parse) would make the two locks above pass for ever while proving nothing.
    const broken = 'export default function App() {\n  return <select value={x} onChange={(e) => set(e)}></select>;\n}';
    expect(findingsFor('fake', broken).some((l) => l.includes('control-unlabeled'))).toBe(true);
  });
});
