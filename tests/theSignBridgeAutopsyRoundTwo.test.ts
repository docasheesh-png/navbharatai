/**
 * AUTOPSY — the SignBridge build, round two (2026-09-26). The items round one left open:
 *
 *  1. Project Mode's gate counted THIRTY-FIVE "features" in a spec that asks for seven — it counted
 *     every prose sentence, every quoted UI string and every line of example code as a list item, so a
 *     single app was split into modules and a planner was paid to decompose it.
 *  2. `webkitSpeechRecognition` has no TypeScript declaration; the model met the same error four times
 *     and was never told why, so it tried four different wrong shapes.
 *  3. The user was told "runnable Vitest skeletons" about files importing a package the project does
 *     not have.
 *  4. Six deterministic passes wrote straight to the saved copy even when Green Freeze had refused the
 *     sandbox write — an unverified edit kept in the app the user publishes.
 *  5. A suggest-only review on a proven-green app that ran out of time was recorded as a WARNING about
 *     the app ("completeness findings NOT available").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { countEnumeratedFeatures, enumeratedFeatureItems } from '../src/server/AgentV3/enumeratedFeatures';
import { detectMegaProject } from '../src/server/AgentV3/ProjectPlan';
import { tscErrorCauses } from '../src/server/AgentV3/tscErrorCause';
import { starterTestsNarration } from '../src/server/AgentV3/TestGenerationAgent';
import { GreenFreezeError } from '../src/server/AgentV3/greenFreeze';
import { writeUnlessFrozen } from '../src/server/routes/agentv3';
import { isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';
import { lintBuiltApp, a11yRepairAddendum } from '../src/server/AgentV3/buildQualityLint';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SIGNBRIDGE = src('tests/fixtures/promptSignbridge.txt');

describe('1 · the gate counts the parts of an app, not the sentences of a spec', () => {
  it('the SignBridge spec is ONE app — Project Mode does not fire on it', () => {
    expect(detectMegaProject(SIGNBRIDGE)).toBe(false);
  });

  it('its count stays in the ordinary range (it was 35)', () => {
    const n = countEnumeratedFeatures(SIGNBRIDGE);
    expect(n).toBeLessThan(10);
    expect(n).toBeGreaterThan(0);
  });

  it('prose sentences, quoted UI strings and code lines are not list items', () => {
    const items = enumeratedFeatureItems([
      'The app must work offline and store every result locally so nothing is lost when the network drops out.',
      '- Show "Camera permission denied" when access is refused',
      'const labels = { hello: "Hello", thanks: "Thank you" };',
      'onResult((e) => setText(e.label));',
    ].join('\n'));
    for (const it of items) {
      expect(it).not.toMatch(/Camera permission denied|const labels|setText/);
    }
  });

  it('a real enumerated app still counts — the precision fix did not blind it', () => {
    const erp = 'Build a school ERP with students, teachers, attendance, fees, exams, timetable, library, transport';
    expect(countEnumeratedFeatures(erp)).toBeGreaterThanOrEqual(6);
    expect(detectMegaProject(erp)).toBe(true);
  });

  it('an unspaced slash is not a separator (and/or, UI/UX stay one item)', () => {
    const items = enumeratedFeatureItems('Features: camera/mic access, UI/UX polish, offline mode');
    expect(items).toEqual(['camera/mic access', 'ui/ux polish', 'offline mode']);
  });
});

describe('1b · a bullet keeps its first letter', () => {
  // The marker strip matched "- S" and deleted the S with the dash, so "- Date" became "ate" and slipped
  // past the record-attribute list — a bulleted list of an expense's COLUMNS counted as features.
  it('items are read whole', () => {
    expect(enumeratedFeatureItems('- Settings page\n- Search\n- History')).toEqual(['settings page', 'search', 'history']);
  });
  it('a bulleted column of a record is not a feature', () => {
    expect(enumeratedFeatureItems('- Date\n- Amount\n- Category\n- Reports')).toEqual(['reports']);
  });
});

describe('2 · speech recognition types are explained the first time', () => {
  const err = (message: string) => ({ file: 'src/hooks/useSpeech.ts', line: 3, col: 5, code: 'TS2304', message });

  it("the report's own error gets the one shape that compiles", () => {
    const causes = tscErrorCauses([err("Cannot find name 'webkitSpeechRecognition'.")]);
    const c = causes.find((x) => x.id === 'web-speech-recognition-types');
    expect(c).toBeTruthy();
    expect(c!.advice).toMatch(/interface SpeechRec/);
  });

  it('four occurrences are ONE note, not four', () => {
    const causes = tscErrorCauses([
      err("Cannot find name 'SpeechRecognition'."),
      err("Cannot find name 'webkitSpeechRecognition'."),
      err("Cannot find name 'SpeechRecognitionEvent'."),
      err("Property 'webkitSpeechRecognition' does not exist on type 'Window & typeof globalThis'."),
    ]);
    expect(causes.filter((x) => x.id === 'web-speech-recognition-types')).toHaveLength(1);
  });

  it('speech SYNTHESIS (which is typed) is not mistaken for it', () => {
    expect(tscErrorCauses([err("Cannot find name 'speechSynthesisX'.")]).some((x) => x.id === 'web-speech-recognition-types')).toBe(false);
  });
});

describe('3 · "runnable" is said only when it is true', () => {
  it('without vitest the user is given the command, never "runnable"', () => {
    const s = starterTestsNarration(['src/a.test.ts'], JSON.stringify({ devDependencies: { vite: '5' } }));
    expect(s).not.toMatch(/runnable/);
    expect(s).toMatch(/npm install -D vitest/);
  });

  it('with vitest declared it is runnable', () => {
    expect(starterTestsNarration(['src/a.test.ts', 'src/b.test.ts'], JSON.stringify({ devDependencies: { vitest: '2' } })))
      .toMatch(/2 starter tests .*runnable/);
  });

  it('an unreadable package.json is treated as "not declared"', () => {
    expect(starterTestsNarration(['x.test.ts'], '{not json')).not.toMatch(/runnable/);
  });
});

describe('4 · a fix the freeze refused is not kept', () => {
  it('refused by Green Freeze ⇒ false', async () => {
    expect(await writeUnlessFrozen(async () => { throw new GreenFreezeError('src/main.tsx', null); })).toBe(false);
  });
  it('written ⇒ true', async () => {
    expect(await writeUnlessFrozen(async () => undefined)).toBe(true);
  });
  it('any other failure (a dead machine) still keeps the correct fix in the saved copy', async () => {
    expect(await writeUnlessFrozen(async () => { throw new Error('sandbox paused'); })).toBe(true);
  });
  it('all six store-direct passes go through it', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect((route.match(/await writeUnlessFrozen\(/g) || []).length).toBeGreaterThanOrEqual(6);
  });
});

describe('5 · an offer that ran out of time is not a finding about the app', () => {
  it('the suggest-only timeout has its own process-only code', () => {
    expect(isAppFinding({ phase: 'build', code: 'REVIEW_SUGGESTIONS_NOT_READY' })).toBe(false);
    expect(isAppFinding({ phase: 'build', code: 'REVIEW_INCOMPLETE' })).toBe(true);
  });
  it('and it is excluded from the user suggestions', () => {
    expect(src('src/server/AgentV3/buildFindingSuggestions.ts')).toContain("'REVIEW_SUGGESTIONS_NOT_READY'");
  });
});

describe('6 · the repair already running also fixes what a screen reader meets', () => {
  const page = [
    'export default function TranslatePage() {',
    '  return (<div className="p-4"><input type="text" className="border" />',
    '    <button className="icon" onClick={() => go()}><svg /></button></div>);',
    '}',
  ].join('\n');

  it("names the linter's own fixes and the files, when there are failures", () => {
    const r = lintBuiltApp({ 'src/pages/TranslatePage.tsx': page });
    const ask = a11yRepairAddendum(r);
    expect(r!.a11y.violations.length).toBeGreaterThan(0);
    expect(ask).toMatch(/accessibility failures/);
    expect(ask).toMatch(/WCAG/);
    expect(ask).toMatch(/TranslatePage\.tsx/);
  });

  it('asks for nothing when the app is clean, or unlintable', () => {
    expect(a11yRepairAddendum(null)).toBe('');
    const clean = lintBuiltApp({ 'src/App.tsx': 'export default function App(){ return <main><h1>Hi</h1><label htmlFor="q">Q</label><input id="q" /></main>; }' });
    expect(a11yRepairAddendum(clean)).toBe('');
  });

  it('it rides the design repair, never starts a pass of its own, and reports the result', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain('`The app is built and compiles. ${designRepairInstruction(design)}${a11yAsk}`');
    expect((route.match(/a11yRepairAddendum\(/g) || []).length).toBe(1);
    expect(route).toContain("'ACCESSIBILITY_HEALED' : 'ACCESSIBILITY_PARTIALLY_HEALED'");
  });
});
