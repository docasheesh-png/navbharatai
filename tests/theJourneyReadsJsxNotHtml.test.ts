/**
 * THE JOURNEY CHECK READS JSX, NOT HTML (autopsy 7d79254b, 2026-09-26).
 *
 * The report said `JOURNEY_NOT_DERIVED` — "form fields have no name or label". They had them. The
 * journey deriver read tags with `<input\b[^>]*>`, and in JSX the first `>` of
 * `onChange={(e) => setEmail(e.target.value)}` belongs to the arrow: the tag "ended" there, and every
 * attribute written after the handler was invisible. The ordinary React input writes `value` and
 * `onChange` first, so the check that proves an app SAVES data had quietly stopped running on most apps.
 * Same class as autopsies c847b523 and 8a92e5ed (`jsxTags.ts`), fourth reader.
 */
import { describe, it, expect } from 'vitest';
import { deriveJourneys, submitTargetIn, wrappingLabelText } from '../src/server/AgentV3/journeyDerivation';

const FORM = `
import { useState } from 'react';
export default function Contact() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const onSubmit = (e) => { e.preventDefault(); setEmail(''); };
  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email" placeholder="Your email" />
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        name="message"
      />
      <button onClick={() => console.log('x')} type="submit">Send message</button>
    </form>
  );
}
`;

describe('attributes after an arrow handler are read', () => {
  it('a form whose inputs name themselves after onChange yields a journey', () => {
    const js = deriveJourneys({ files: { 'src/pages/Contact.tsx': FORM }, routes: ['/contact'], marker: 'nbai-x' });
    expect(js).toHaveLength(1);
    expect(js[0].fields.map((f) => f.target)).toEqual([
      { kind: 'name', value: 'email' },
      { kind: 'name', value: 'message' },
    ]);
    expect(js[0].fields[0].value).toBe('nbai-x@example.com');
  });

  it('a submit button with its handler first is found by its type, with its real text', () => {
    expect(submitTargetIn(FORM)).toEqual({ kind: 'text', value: 'Send message' });
  });

  it('a button\'s text is never the tail of its own tag', () => {
    const src = `<button onClick={() => addTask()} className="btn">Add task</button>`;
    expect(submitTargetIn(src)).toEqual({ kind: 'text', value: 'Add task' });
  });
});

describe('a control wrapped in its label is addressed by the label', () => {
  const LABELLED = `
export default function Notes() {
  const [t, setT] = useState('');
  const [notes, setNotes] = useState([]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); setNotes([...notes, t]); }}>
      <label>
        Note title
        <input value={t} onChange={(e) => setT(e.target.value)} />
      </label>
      <button type="submit">Add note</button>
      <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </form>
  );
}
`;

  it('reads the label\'s plain text', () => {
    expect(wrappingLabelText(LABELLED, LABELLED.indexOf('<input'))).toBe('Note title');
  });

  it('derives the create-then-reload journey through getByLabel', () => {
    const js = deriveJourneys({ files: { 'src/pages/Notes.tsx': LABELLED }, routes: ['/notes'], marker: 'nbai-y' });
    expect(js).toHaveLength(1);
    expect(js[0].kind).toBe('create-persists');
    expect(js[0].fields[0].target).toEqual({ kind: 'label', value: 'Note title' });
  });

  it('an interpolated label is not guessed at', () => {
    const src = `<label>Amount ({currency}) <input value={a} onChange={(e) => setA(e.target.value)} /></label>`;
    expect(wrappingLabelText(src, src.indexOf('<input'))).toBeNull();
  });

  it('two labels that one selector would both match are not used', () => {
    const src = `<form onSubmit={save}>
      <label>Name <input value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label>Last name <input value={b} onChange={(e) => setB(e.target.value)} /></label>
      <button type="submit">Save</button></form>`;
    expect(deriveJourneys({ files: { 'src/pages/P.tsx': src }, routes: ['/p'], marker: 'm' })).toEqual([]);
  });

  it('an input that is not inside a label is not given one', () => {
    const src = `<label>Title</label>\n<input value={t} onChange={(e) => setT(e.target.value)} />`;
    expect(wrappingLabelText(src, src.indexOf('<input'))).toBeNull();
  });
});

describe('what it still refuses — a field with nothing to address it by', () => {
  it('a bare controlled input yields no journey, as before', () => {
    const src = `<form onSubmit={save}><input value={t} onChange={(e) => setT(e.target.value)} /><button type="submit">Save</button></form>`;
    expect(deriveJourneys({ files: { 'src/pages/P.tsx': src }, routes: ['/p'], marker: 'm' })).toEqual([]);
  });

  it('a component is not read as the element it wraps', () => {
    const src = `<form onSubmit={save}><Input value={t} onChange={(e) => setT(e.target.value)} /><button type="submit">Save</button></form>`;
    expect(deriveJourneys({ files: { 'src/pages/P.tsx': src }, routes: ['/p'], marker: 'm' })).toEqual([]);
  });
});

describe('the login-flow spec had the same reader, and now shares the fixed one', () => {
  it('reads type="password" and the submit button written after an arrow handler', async () => {
    const { selectorForSubmit, selectorForInput } = await import('../src/server/AgentV3/authFlowSpec');
    const src = `<form onSubmit={login}>
      <input value={e} onChange={(ev) => setE(ev.target.value)} type="email" />
      <input value={p} onChange={(ev) => setP(ev.target.value)} type="password" />
      <button onClick={() => track('login')} type="submit">Log in</button>
    </form>`;
    expect(selectorForSubmit(src)).toBe('button[type="submit"]');
    const { scanMarkup } = await import('../src/server/AgentV3/jsxTags');
    const inputs = scanMarkup(src).filter((t) => t.name === 'input').map((t) => selectorForInput(t.tag));
    expect(inputs).toEqual(['input[type="email"]', 'input[type="password"]']);
  });

  it('🔒 no JSX reader in these two files is a `[^>]*` regex again', () => {
    // tsc and vitest cannot see which dialect a regex reads — that is how four readers shipped blind.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    for (const f of ['src/server/AgentV3/journeyDerivation.ts', 'src/server/AgentV3/authFlowSpec.ts']) {
      const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
      // A tag name followed by `\b[^>]*` — the reader that stops at an arrow's `>`. (The one lazy
      // `[^>]*?` left in journeyDerivation only LOCATES a handler, and missing it answers 'unknown'.)
      expect(code, f).not.toMatch(/(?:input|textarea|select|button)\)?\\b\[\^>\]\*(?!\?)/);
    }
  });
});
