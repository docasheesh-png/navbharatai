// AUTOPSY 8a92e5ed (2026-09-20) — one build report, two findings, neither of them true.
//
// A free user asked for a password generator. NavBharatAI pre-seeded its own golden scaffold, the app
// rendered, `tsc` and `npm run build` were clean, and the report then said:
//
//   • ACCESSIBILITY 76/100 — "3 form field(s) with no label"   ← all three ARE labelled
//   • FEATURE_COVERAGE — "Mark complete / toggle" has no control, "Login / authentication" present
//     ← the app has neither, was asked for neither, and this line became the build's rootCause
//
// Both are the same defect in two subsystems: a rule that reads a fragment of the evidence and
// concludes from it. Below, each one is pinned with the real prompt and the real markup, and each
// fix is proven by reversion — delete it and the named test fails.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { scanMarkup, hasAttr, isHtmlElement, tagName } from '../src/server/AgentV3/jsxTags';
import { inputsMissingLabel, controlsMissingName, imagesMissingAlt, lintA11y } from '../src/server/AppMakerLab/intelligence/A11yLinter';
import { checkFeaturePresence } from '../src/server/AgentV3/FeaturePresence';
import { passwordGenAppTsx } from '../src/server/AgentV3/goldenScaffolds/appsB';

// The scaffold's own markup, as written — the exact shape that was called unlabelled.
const WRAPPED_CHECKBOX = `
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> Uppercase letters (A-Z)
        </label>`;

describe('the markup reader', () => {
  it('🔒 a wrapping <label> labels the control, even when it opens on an earlier line', () => {
    expect(inputsMissingLabel(WRAPPED_CHECKBOX)).toEqual([1, 0]);
  });

  it('🔒 an attribute written AFTER an arrow handler is still read', () => {
    // `[^>]*` ends at the `>` of `=>`, so everything after the first handler was invisible — including
    // the very attribute the rule is looking for. This is the whole-analyzer bug, seen through labels.
    const code = '<input value={x} onChange={(e) => set(e.target.value)} aria-label="Search" />';
    expect(inputsMissingLabel(code)).toEqual([1, 0]);
    expect(imagesMissingAlt('<img src={s} onLoad={() => done()} alt="A chart" />')).toEqual([1, 0]);
  });

  it('🔒 a COMPONENT is not judged by the rules for the HTML element it is named after', () => {
    // We cannot know a component's contract. `<Select label="Category" />` has a real, working label.
    expect(inputsMissingLabel('<Select label="Category" value={g} onChange={(e) => setG(e)} />')).toEqual([0, 0]);
    expect(isHtmlElement('<Dialog.Root open={o}>')).toBe(false);
    expect(isHtmlElement('<input />')).toBe(true);
    expect(tagName('<Dialog.Root open={o}>')).toBe('Dialog.Root');
  });

  it('⚠️ and a control that really has no label is still caught, multi-line included', () => {
    // The fix must buy precision with correctness, never with silence: a generated React input is
    // routinely written over six lines, and those are exactly the ones this engine writes most.
    const code = 'return (\n  <input\n    value={email}\n    onChange={(e) => setEmail(e.target.value)}\n    placeholder="you@example.com"\n  />\n);';
    expect(inputsMissingLabel(code)).toEqual([1, 1]);
  });

  it('⚠️ plain HTML behaves exactly as it did — this module still lints HTML too', () => {
    expect(inputsMissingLabel('<input type="text"><input type="text" id="email"><input type="hidden"><input type="submit">')).toEqual([2, 1]);
    expect(inputsMissingLabel('<input aria-label="Name"><select id="s"></select>')).toEqual([2, 0]);
  });

  it('🔒 each button is judged by its OWN text, not by the first one that shares its tag', () => {
    // Three `<button>` tags spell the same six characters, so a search for the tag TEXT returns the
    // first one every time and every later button inherits its content.
    const code = '<button><svg></svg></button><button>Save</button><button aria-label="Close"></button>';
    expect(controlsMissingName(code)).toEqual([3, 1]);
  });

  it('a label closes, and a self-closing <label /> opens nothing', () => {
    const after = '<label>Name</label>\n<input value={v} onChange={(e) => set(e)} />';
    expect(inputsMissingLabel(after)).toEqual([1, 1]);   // sibling label with no htmlFor is not a label
    const selfClosing = '<label />\n<input value={v} onChange={(e) => set(e)} />';
    expect(inputsMissingLabel(selfClosing)).toEqual([1, 1]);
    expect(scanMarkup(WRAPPED_CHECKBOX).filter((t) => t.name === 'input')[0].insideLabel).toBe(true);
    expect(hasAttr('<img data-alt="x" />', 'alt')).toBe(false);
  });

  it('🔴 THE REPORT ITSELF: our own password-generator template is clean', () => {
    const r = lintA11y(passwordGenAppTsx);
    expect(r.violations.filter((v) => v.type === 'input-label')).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('⚠️ the HTML-shaped tag regexes are gone from the linter (reversion guard)', () => {
    // `tsc` and `vitest` cannot see that a regex reads the wrong dialect — the module compiled and its
    // suite passed throughout the outage. Only the source says which reader is in use.
    const src = fs.readFileSync(path.join(__dirname, '../src/server/AppMakerLab/intelligence/A11yLinter.ts'), 'utf8');
    expect(src).toContain("from '../../AgentV3/jsxTags'");
    expect(src).not.toMatch(/<input\\b\[\^>\]\*>/);
    expect(src).not.toMatch(/<img\\b\[\^>\]\*>/);
    expect(src).not.toMatch(/<\(button\|a\)\\b\(\[\^>\]\*\)>/);
  });
});

describe('a feature keyword carries a sense, not just a spelling', () => {
  const PROMPT = 'Build a password generator: choose the length with a slider and toggle uppercase, numbers and symbols, generate a strong random password, show a strength meter, and copy it to the clipboard with one tap.';
  // What that app really renders. The `type="password"` field is deliberate and is the whole point:
  // in the real report `auth` probed PRESENT off exactly that, and a present probe is what satisfies
  // the corroboration guard — the one rule whose job is to stop a lone unproven signal indicting a
  // working app. So the false POSITIVE is what certified the false NEGATIVE. Remove either fix and
  // this fixture reproduces the report.
  const HTML = `<div id="root"><h1>Password Generator</h1><input type="password" readonly value="hunter2" aria-label="Generated password" />
    <button>Generate</button><button>Copy</button>
    <label>Length: 16</label><input type="range" aria-label="Password length" />
    <label><input type="checkbox" /> Uppercase letters</label>
    <label><input type="checkbox" /> Numbers</label>
    <label><input type="checkbox" /> Symbols</label></div>`;

  it('🔴 THE REPORT ITSELF: a password generator requests neither task-completion nor login', () => {
    const r = checkFeaturePresence(PROMPT, HTML);
    expect(r.missing).toEqual([]);
    expect(r.probes.map((p) => p.feature)).not.toContain('complete');
    expect(r.probes.map((p) => p.feature)).not.toContain('auth');
  });

  it('⚠️ and a real task manager still gets both probes — precision, not silence', () => {
    const TASKLITE = 'Build the smallest task manager. Features: Add task, Delete task, Mark complete, Filter: All, Active, Completed.';
    const app = '<div id="root"><input placeholder="New task" /><button>Add</button><ul><li><input type="checkbox" /> Buy milk <button>Delete</button></li></ul><button>All</button><button>Active</button></div>';
    const r = checkFeaturePresence(TASKLITE, app);
    const complete = r.probes.find((p) => p.feature === 'complete');
    expect(complete, 'a task manager that says "Mark complete" must still be probed').toBeTruthy();
    expect(complete?.present).toBe(true);
  });

  it('⚠️ a login page is still recognised without the word "password" doing the work', () => {
    const r = checkFeaturePresence('Build a login page with email and password and a sign up tab', '<div id="root"><input type="email" /><input type="password" /><button>Sign in</button></div>');
    expect(r.probes.find((p) => p.feature === 'auth')?.present).toBe(true);
  });

  it('a settings switch is not a task being finished', () => {
    const r = checkFeaturePresence('A notes app where you can toggle dark mode and toggle the sidebar', '<div id="root"><button>Dark</button><ul><li>note</li></ul></div>');
    expect(r.probes.map((p) => p.feature)).not.toContain('complete');
  });
});
