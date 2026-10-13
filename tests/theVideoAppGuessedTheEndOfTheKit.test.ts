// Autopsy 9c612cdb (2026-10-12), Q-986 — the stylesheet append guessed an anchor.
//
// The builder was told "Add the rules to src/index.css now" and, in its prompt, to extend the design kit "by
// APPENDING (edit_file, new rules at the end)". Nothing it could see BEFORE its first attempt said how to
// append without an anchor, so it quoted the kit's last lines from its compacted memory of an old read,
// re-typed a rule after them, and missed: the closest-match branch of the not-found error (lines 502-538,
// nearest at line 526) was the one branch that never offered the empty-old_string append. 28.4 s and 1,952
// output tokens were thrown away and the whole CSS was resent.
//
// THE CLASS: an instruction that asks the model to ADD to a file without naming the anchor-free way to do
// it — taught, until now, only inside failure messages. Five earlier autopsies each healed one more failure
// branch; none told the first attempt. Locked here at every layer: the tool contract, the prompts, the
// write-time notes, the last failure branch, the compaction marker the anchor came from — and a census that
// fails CI when a NEW "add rules to the stylesheet" instruction is written without the shared sentence.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { APPEND_WITH_EMPTY_OLD_STRING } from '../src/server/AgentV3/appendByEdit';
import { applyEdit, nearestEditRegion } from '../src/server/AgentV3/ToolDispatcher';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { architectSystemPrompt, editModePrefix } from '../src/server/AgentV3/systemPrompt';
import { undefinedClassesWriteNote, undefinedClassWriteNote, stylesheetClassBrief, cssConsistencyError } from '../src/server/AgentV3/CssConsistency';
import { inventedKitClassNote, kitKeepToolNote } from '../src/server/AgentV3/kitRestore';
import { deadThemeSwitchNote } from '../src/server/AgentV3/deadThemeSwitch';
import { compactTranscriptForModel } from '../src/server/AgentV3/SessionTimeline';
import { instructionCensus, sourceFiles } from './helpers/instructionCensus';

/** The report's failing old_string: the kit's lines 525-526 as a compacted tail kept them, then a re-typed rule. */
const REPORT_OLD_STRING = [
  'removing it would hide that something is',
  '   loading); it simply stops rotating. */',
  '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; } }',
].join('\n');

function missMessage(content: string, oldStr: string, path: string): string {
  try { applyEdit(content, oldStr, '.app-shell { display: grid; }', path); } catch (e) { return (e as Error).message; }
  throw new Error('expected the edit to miss');
}

describe('1 · the report\'s own miss now names the append', () => {
  it('🔴 the closest-match branch, on the real kit and the real old_string, says how to add without an anchor', () => {
    const kitLines = DESIGN_KIT_CSS.split('\n');
    // Line 526 in the report's 538-line kit; computed, so a later kit edit does not break the test.
    const nearest = kitLines.indexOf('   loading); it simply stops rotating. */') + 1;
    expect(nearest).toBeGreaterThan(0);
    const msg = missMessage(DESIGN_KIT_CSS, REPORT_OLD_STRING, 'src/index.css');
    expect(msg).toContain(`around your closest match (lines ${nearest - 24}-`);
    expect(msg).toContain(`nearest at line ${nearest})`);
    expect(msg).toMatch(/EMPTY old_string/);
    expect(msg).toContain(APPEND_WITH_EMPTY_OLD_STRING);
  });

  it('the hint follows the evidence: a window reaching the end of ANY file, or any stylesheet — not every miss', () => {
    const file = Array.from({ length: 120 }, (_, i) => `const value${i} = ${i};`).join('\n');
    // Near the end of a code file: an addition is plausible.
    expect(nearestEditRegion(file, 'const value110 = 110;\nconst valueGuessed = 1;', undefined, undefined, { path: 'src/data.ts' }))
      .toContain(APPEND_WITH_EMPTY_OLD_STRING);
    // Mid-file in a code file: a change, not an addition — no hint.
    expect(nearestEditRegion(file, 'const value40 = 40;\nconst valueGuessed = 1;', undefined, undefined, { path: 'src/data.ts' }))
      .not.toContain(APPEND_WITH_EMPTY_OLD_STRING);
    // Mid-file in a stylesheet: still an addition, nearly always.
    const css = Array.from({ length: 120 }, (_, i) => `.rule-${i} { margin: ${i}px; }`).join('\n');
    expect(nearestEditRegion(css, '.rule-40 { margin: 40px; }\n.guessed { x: y; }', undefined, undefined, { path: 'src/index.css' }))
      .toContain(APPEND_WITH_EMPTY_OLD_STRING);
  });

  it('the append the message teaches really works on the kit', () => {
    const r = applyEdit(DESIGN_KIT_CSS, '', '.app-shell { display: grid; }', 'src/index.css');
    expect(r.updated.startsWith(DESIGN_KIT_CSS)).toBe(true);
    expect(r.updated.trimEnd().endsWith('.app-shell { display: grid; }')).toBe(true);
  });

  it('the sentence says old_string: "" literally, so no alias key is sent beside it', () => {
    expect(APPEND_WITH_EMPTY_OLD_STRING).toContain('old_string: ""');
    expect(APPEND_WITH_EMPTY_OLD_STRING).toMatch(/EMPTY old_string — it appends/); // the phrase older pins read
  });
});

describe('2 · the first attempt is told — the contract and the prompts', () => {
  it('the edit_file contract every lane reads carries the append', () => {
    const edit = defaultToolCatalog().find((t) => t.name === 'edit_file');
    expect(edit?.description).toContain(APPEND_WITH_EMPTY_OLD_STRING);
    const oldProp = (edit?.input_schema as { properties: Record<string, { description: string }> }).properties.old_string;
    expect(oldProp.description).toMatch(/EMPTY string \(""\) appends new_string to the end of the file/);
  });

  it('the architect is told HOW right where it is told to append to the kit', () => {
    const p = architectSystemPrompt('vite-react');
    const at = p.indexOf('Add your app\'s styles by APPENDING');
    expect(at).toBeGreaterThan(0);
    expect(p.slice(at, at + 400)).toContain(APPEND_WITH_EMPTY_OLD_STRING);
  });

  it('every reader of DESIGN_KIT_BRIEF ("extend the kit in index.css") puts the sentence beside it', () => {
    const p = architectSystemPrompt('vite-react');
    const at = p.indexOf('never drop back to unstyled markup');
    expect(at).toBeGreaterThan(0);
    expect(p.slice(at, at + 600)).toContain(APPEND_WITH_EMPTY_OLD_STRING);
    const subAgent = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');
    const brief = subAgent.indexOf("DESIGN_KIT_BRIEF.join('\\n')");
    expect(brief).toBeGreaterThan(0);
    expect(subAgent.slice(brief - 400, brief)).toContain('APPEND_WITH_EMPTY_OLD_STRING');
    // …and there is no third reader that would not.
    const readers = sourceFiles('src/server').filter((f) => /DESIGN_KIT_BRIEF\b/.test(readFileSync(f, 'utf8')));
    expect(readers.sort()).toEqual(['src/server/AgentV3/SubAgent.ts', 'src/server/AgentV3/systemPrompt.ts']);
  });

  it('an edit build is told too (editModePrefix rule 3)', () => {
    expect(editModePrefix(['src/App.tsx', 'src/index.css'])).toContain(APPEND_WITH_EMPTY_OLD_STRING);
  });
});

describe('3 · every write-time note that asks for an addition says how', () => {
  // The report's own note: "src/App.tsx uses .add-link-btn, .app-brand, … and 9 more" (the 9 were cut).
  const REPORT_CLASSES = ['add-link-btn', 'app-brand', 'app-header', 'app-main', 'app-shell', 'brand-logo', 'brand-title', 'empty-icon'];

  it('🔴 the note this build received', () => {
    const note = undefinedClassesWriteNote('src/App.tsx', REPORT_CLASSES);
    expect(note).toMatch(/Add the rules to src\/index\.css now/); // the sentence older tests pin, kept
    expect(note).toContain(APPEND_WITH_EMPTY_OLD_STRING);
  });

  it('its siblings: the stylesheet-write note, the invented-kit note, the kit-kept note, the class brief, the dead theme switch', () => {
    const sheet = { 'src/index.css': '.card { padding: 8px; }' };
    expect(undefinedClassWriteNote({ 'src/index.css': '.card { padding: 8px; }' }, { 'src/App.tsx': '<div className="app-shell app-main card">x</div>' }))
      .toContain(APPEND_WITH_EMPTY_OLD_STRING);
    expect(inventedKitClassNote('src/App.tsx', ['nb-hud'])).toContain(APPEND_WITH_EMPTY_OLD_STRING);
    expect(kitKeepToolNote('src/index.css', { content: '', kept: ['nb-card'], tokens: [] })).toContain(APPEND_WITH_EMPTY_OLD_STRING);
    expect(stylesheetClassBrief(sheet)).toContain(APPEND_WITH_EMPTY_OLD_STRING);
    const app = "export function App() { const t = () => document.documentElement.classList.toggle('dark'); return <button onClick={t}>Theme</button>; }";
    expect(deadThemeSwitchNote('src/App.tsx', app, { 'src/App.tsx': app, 'src/index.css': ':root { --bg: #fff; }' }))
      .toContain(APPEND_WITH_EMPTY_OLD_STRING);
  });

  it('the end-of-build CSS error stays tool-free (the fast lane repairs WITHOUT tools), and its tool-using reader adds the sentence', () => {
    const files = { 'src/index.css': '.a { color: red; }', 'src/App.tsx': '<div className="one two three four">x</div>' };
    const err = cssConsistencyError(files);
    expect(err).not.toBeNull();
    expect(err).not.toContain('edit_file');
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/const cssAsk = [^\n]*\$\{cssErr\}[^\n]*\$\{APPEND_WITH_EMPTY_OLD_STRING\}/);
  });
});

describe('4 · the shortened view the anchor came from says it is not a source to quote', () => {
  it('an old read of the kit is compacted with the warning, and the old wording is kept', () => {
    const messages: unknown[] = [
      { role: 'user', content: 'build the video app' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'read_file', input: { path: 'src/index.css' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: DESIGN_KIT_CSS }] },
    ];
    for (let i = 0; i < 4; i++) {
      messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `w${i}`, name: 'write_file', input: { path: `src/F${i}.tsx`, content: 'x' } }] });
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `w${i}`, content: 'ok' }] });
    }
    const out = compactTranscriptForModel(messages, { keepRecentMessages: 6, maxOldToolResultChars: 2_000 }) as Array<{ content: unknown }>;
    const kept = ((out[2].content as Array<{ content: string }>)[0]).content;
    expect(kept.length).toBeLessThan(DESIGN_KIT_CSS.length);
    expect(kept).toContain('NEVER conclude a file is truncated');
    expect(kept).toContain('quote an edit_file old_string from this view');
    expect(kept).toContain('to ADD at the end, old_string: "" appends');
    // The marker rides every compacted result on every turn: the sentence must not have made it long.
    expect(kept.length).toBeLessThan(2_000 + 300);
    // The kept tail is the END of the kit — exactly the lines a model would anchor an "append" on.
    expect(DESIGN_KIT_CSS.endsWith(kept.slice(kept.lastIndexOf('] …\n') + 4))).toBe(true);
  });
});

describe('5 · 🔒 CENSUS — a new "add rules to the stylesheet" instruction cannot be written without the sentence', () => {
  const CLASS = [
    /\b(add|adding|append|appending|extend)\b[^.;:]{0,60}\b(rules?|styles)\b/i,
    /\b(define|add|adding|append|appending|extend)\b[^.;:]{0,60}(stylesheet|index\.css|style\.css|\$\{sheet\}|\bthe kit\b)/i,
  ];
  const FILES = [...sourceFiles('src/server/AgentV3'), 'src/server/routes/agentv3.ts']
    .filter((f) => !f.endsWith('AgentV3/appendByEdit.ts'));

  /** Each entry: where, a distinctive substring of the unit, and why it needs no sentence. */
  const ALLOWED: Array<{ file: string; has: string; why: string; check?: (text: string) => boolean }> = [
    { file: 'CssConsistency.ts', has: 'the components and the stylesheet AGREE', why: 'cssConsistencyError is shared with the fast lane, whose repair writes whole files with NO tools — naming edit_file there would be an instruction it cannot follow; its tool-using reader (the design heal) appends the sentence — section 3 checks it' },
    { file: 'CssModuleGenerator.ts', has: 'add real styles as needed', why: 'a comment written INTO a generated CSS module for the developer, not an instruction to a model' },
    { file: 'PageRouteCheck.ts', has: 'nbai-pagecheck', why: 'a shell script, not prose' },
    { file: 'SimpleBuilder.ts', has: 'Add element and state rules as the design needs', why: 'the fast lane writes whole files with no tools — there is no edit_file to append with' },
    { file: 'SimpleBuilder.ts', has: 'add any class you use to it when you write that stylesheet', why: 'the fast lane writes whole files with no tools' },
    { file: 'buildFindingSuggestions.ts', has: 'Add the missing rules to the app', why: 'a suggestion the USER sends as their own message — tool mechanics do not belong in their words; the edit build it starts reads the edit_file contract' },
    { file: 'systemPrompt.ts', has: 'extend the kit in index.css', why: 'DESIGN_KIT_BRIEF — both of its readers put the sentence beside it (section 2 checks both, and that there is no third)' },
    { file: 'systemPrompt.ts', has: 'define the equivalents ONCE in the project', why: 'kit-less scaffolds: WHAT to define once; the same architect prompt states the append sentence at its stylesheet rule (section 2)' },
    { file: 'routes/agentv3.ts', has: 'Adding the styles your screens use', why: 'a narration line the USER reads, not an instruction' },
  ];

  const hits = instructionCensus(FILES, CLASS, 'APPEND_WITH_EMPTY_OLD_STRING');
  const allowedFor = (h: { file: string; text: string }) => ALLOWED.find((a) => h.file.endsWith(a.file) && h.text.includes(a.has));

  it('the census really sees this build\'s instruction (it cannot have gone blind)', () => {
    expect(CLASS.some((re) => re.test('Add the rules to src/index.css now (or use a class the stylesheet already has)'))).toBe(true);
    expect(CLASS.some((re) => re.test('Add your app\'s styles by APPENDING'))).toBe(true);
    expect(hits.filter((h) => h.covered).length).toBeGreaterThanOrEqual(8);
  });

  it('every instruction carries APPEND_WITH_EMPTY_OLD_STRING or a written reason', () => {
    const bare = hits.filter((h) => !h.covered && !allowedFor(h)).map((h) => `${h.file}:${h.line} — ${h.text.slice(0, 120)}`);
    expect(bare).toEqual([]);
  });

  it('an allowance is checked, and none is stale', () => {
    for (const a of ALLOWED) {
      const found = hits.filter((h) => h.file.endsWith(a.file) && h.text.includes(a.has));
      expect(found.length, `stale allowance: ${a.file} "${a.has}"`).toBeGreaterThan(0);
      if (a.check) for (const h of found) expect(a.check(h.text), `${a.file}: ${a.why}`).toBe(true);
    }
  });
});
