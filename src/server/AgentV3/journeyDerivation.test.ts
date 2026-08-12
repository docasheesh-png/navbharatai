import { describe, it, expect } from 'vitest';
import {
  deriveJourneys, journeyScript, parseJourneyResults, summarizeJourneys, noJourneyReason,
  targetForInput, valueForInput, submitTargetIn, rendersList, writesToUserDatabase,
  MAX_JOURNEYS, type JourneyResult,
} from './journeyDerivation';

/**
 * THE WHOLE POINT: catch the app that PRETENDS.
 *
 * You type a task, press Add, the item appears, you reload and it is gone — pushed into a useState
 * array and never saved anywhere. That app renders perfectly, throws no errors, returns 200 on every
 * route, and passes every check this platform owns. Only create → reload → still there catches it.
 *
 * The second concern running through this file is the opposite one: never invent a failure. A journey
 * we cannot ground in a selector the app really has is not derived at all, and a journey that never
 * reached the app's own behaviour is reported UNREACHABLE, never FAILED.
 */

const MARKER = 'nbai-7f3a';

const todoApp = (extra = ''): Record<string, string> => ({
  'src/pages/Todos.tsx': `
    export default function Todos() {
      const [items, setItems] = useState([]);
      return (
        <form onSubmit={add}>
          <input name="title" placeholder="What needs doing?" />
          <button type="submit">Add</button>
          <ul>{items.map((t) => (<li key={t.id}>{t.title}</li>))}</ul>
        </form>
      );
    }` + extra,
});

describe('addressing a field the way the app really exposes it', () => {
  it('prefers a test id — it is a promise the author made to tests', () => {
    expect(targetForInput('<input data-testid="title-field" name="title" />'))
      .toEqual({ kind: 'testid', value: 'title-field' });
  });

  it('then the name the form itself submits', () => {
    expect(targetForInput('<input name="email" placeholder="Email" />')).toEqual({ kind: 'name', value: 'email' });
  });

  it('placeholder last — it is user-visible copy, and copy changes', () => {
    expect(targetForInput('<input placeholder="Your email" />')).toEqual({ kind: 'placeholder', value: 'Your email' });
  });

  it('REFUSES a field it cannot address — no selector is invented', () => {
    // Without this the journey would fail on a working app, which teaches people to ignore the report.
    expect(targetForInput('<input type="text" className="w-full" />')).toBeNull();
  });

  it('refuses an interpolated attribute, which is not a literal selector at all', () => {
    expect(targetForInput('<input name={field.key} />')).toBeNull();
    expect(targetForInput('<input placeholder={`Enter ${label}`} />')).toBeNull();
  });
});

describe('typing something the field will actually accept', () => {
  it('an email field gets an email, not the word test', () => {
    expect(valueForInput('<input type="email" />', MARKER)).toBe(`${MARKER}@example.com`);
    expect(valueForInput('<input name="userEmail" />', MARKER)).toContain('@');
  });

  it('a password field gets something that passes an ordinary strength rule', () => {
    // "test" fails half the validators a generated signup form ships with, and then we would be
    // reporting the app broken for correctly rejecting our input.
    const v = valueForInput('<input type="password" />', MARKER);
    expect(v).toMatch(/[A-Z]/);
    expect(v).toMatch(/[0-9]/);
    expect(v.length).toBeGreaterThanOrEqual(8);
  });

  it('numeric and date fields get parseable values', () => {
    expect(valueForInput('<input type="number" />', MARKER)).toBe('7');
    expect(valueForInput('<input name="price" />', MARKER)).toBe('7');
    expect(valueForInput('<input type="date" />', MARKER)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a plain text field gets the marker, so the assertion can find it later', () => {
    expect(valueForInput('<input name="title" />', MARKER)).toBe(MARKER);
  });
});

describe('finding the button that submits', () => {
  it('takes type=submit as the honest answer', () => {
    expect(submitTargetIn('<button type="submit">Add task</button>')).toEqual({ kind: 'text', value: 'Add task' });
  });

  it('accepts an unambiguous verb when there is no submit type', () => {
    expect(submitTargetIn('<button onClick={add}>Create item</button>')).toEqual({ kind: 'text', value: 'Create item' });
  });

  it('REFUSES an ambiguous button rather than clicking the wrong thing', () => {
    // A page whose only button says "Menu" yields no journey. Clicking it would prove nothing and
    // might navigate away mid-test.
    expect(submitTargetIn('<button onClick={open}>Menu</button>')).toBeNull();
    expect(submitTargetIn('<button>Cancel</button>')).toBeNull();
  });

  it('handles the old markup too', () => {
    expect(submitTargetIn('<input type="submit" value="Sign up" />')).toEqual({ kind: 'text', value: 'Sign up' });
  });
});

describe('deriving the journey', () => {
  it('derives create-persists when the page both takes input and renders a list', () => {
    const js = deriveJourneys({ files: todoApp(), marker: MARKER });
    expect(js).toHaveLength(1);
    expect(js[0].kind).toBe('create-persists');
    expect(js[0].fields[0].value).toBe(MARKER);
    expect(js[0].submit).toEqual({ kind: 'text', value: 'Add' });
  });

  it('falls back to form-submit when nothing on the page lists anything', () => {
    // "Did the item appear?" needs somewhere for it to appear. Without a list the question is
    // unanswerable, so we ask the smaller question we can actually answer.
    const js = deriveJourneys({
      files: { 'src/pages/Contact.tsx': '<form><input name="email" /><button type="submit">Send</button></form>' },
      marker: MARKER,
    });
    expect(js[0].kind).toBe('form-submit');
  });

  it('derives NOTHING from a page whose fields cannot be addressed', () => {
    const js = deriveJourneys({
      files: { 'src/pages/X.tsx': '<form><input className="x" /><button type="submit">Add</button></form>' },
      marker: MARKER,
    });
    expect(js).toEqual([]);
  });

  it('derives nothing from a page with no submit control', () => {
    expect(deriveJourneys({
      files: { 'src/pages/X.tsx': '<input name="q" placeholder="Search" />' },
      marker: MARKER,
    })).toEqual([]);
  });

  it('never types into a file picker, a hidden field or a checkbox', () => {
    const js = deriveJourneys({
      files: {
        'src/pages/X.tsx': `<form>
          <input type="hidden" name="csrf" />
          <input type="file" name="avatar" />
          <input type="checkbox" name="agree" />
          <input name="title" />
          <button type="submit">Save</button>
        </form>`,
      },
      marker: MARKER,
    });
    expect(js[0].fields.map((f) => f.target.value)).toEqual(['title']);
  });

  it('covers the single-page app that keeps everything in App.tsx', () => {
    const js = deriveJourneys({
      files: {
        'src/App.tsx': '<form><input name="title" /><button type="submit">Add</button>{rows.map((r) => (<li>{r}</li>))}</form>',
      },
      marker: MARKER,
    });
    expect(js).toHaveLength(1);
    expect(js[0].kind).toBe('create-persists');
  });

  it('is capped and deterministic — the same project derives the same journeys', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i += 1) {
      files[`src/pages/P${i}.tsx`] = '<form><input name="title" /><button type="submit">Add</button></form>';
    }
    const a = deriveJourneys({ files, marker: MARKER });
    const b = deriveJourneys({ files, marker: MARKER });
    expect(a.length).toBeLessThanOrEqual(MAX_JOURNEYS);
    expect(a.map((j) => j.id)).toEqual(b.map((j) => j.id));
  });

  it('survives junk input', () => {
    expect(deriveJourneys({ files: {}, marker: MARKER })).toEqual([]);
    expect(deriveJourneys(null as never)).toEqual([]);
  });
});

/**
 * WRITING INTO SOMEBODY ELSE'S DATABASE.
 *
 * A create journey inserts a real row. Against the app's own local state that is nothing; against the
 * user's own Supabase or Firebase project it is us putting junk data into their real account without
 * being asked, and "it was only a test item" is not a defence.
 */
describe('a journey that writes must not write into the user\'s own database', () => {
  it('recognises the user\'s own database from their code', () => {
    expect(writesToUserDatabase({ 'src/lib/db.ts': "import { createClient } from '@supabase/supabase-js';" })).toBe(true);
    expect(writesToUserDatabase({ 'src/fb.ts': 'const db = getFirestore(app);' })).toBe(true);
    expect(writesToUserDatabase({ '.env': 'DATABASE_URL=postgres://x' })).toBe(true);
  });

  it('a local-state app is not one', () => {
    expect(writesToUserDatabase(todoApp())).toBe(false);
  });

  it('the create journey is DOWNGRADED, not silently skipped, when a real database is wired up', () => {
    const files = { ...todoApp(), 'src/lib/db.ts': "import { createClient } from '@supabase/supabase-js';" };
    const js = deriveJourneys({ files, marker: MARKER });
    expect(js[0].kind).toBe('form-submit');
    expect(js[0].kind).not.toBe('create-persists');
  });

  it('every journey declares whether it writes, so the caller can refuse it', () => {
    for (const j of deriveJourneys({ files: todoApp(), marker: MARKER })) {
      expect(typeof j.writes).toBe('boolean');
    }
  });
});

describe('the runner script', () => {
  const script = journeyScript('https://x.e2b.app/', deriveJourneys({ files: todoApp(), marker: MARKER }), MARKER);

  it('is real JavaScript, not a template that only looks like it', () => {
    // Guarding the guard. A generated script with a syntax error fails silently inside the sandbox —
    // the grep finds no result lines and the check reports "nothing ran" forever. This has happened
    // before in this codebase, which is why it is asserted rather than assumed.
    const body = /cat > \/tmp\/nbai-journey\.mjs <<'NBAI_EOF'\n([\s\S]*?)\nNBAI_EOF/.exec(script)?.[1];
    expect(body, 'the heredoc body is missing').toBeTruthy();
    expect(() => new Function(`return (async () => {${(body as string).replace(/^import .*$/m, '')}})`)).not.toThrow();
  });

  it('imports Playwright by ABSOLUTE path — NODE_PATH does not exist for an ES module', () => {
    expect(script).toContain('/home/user/.e-tools/node_modules/playwright/index.js');
  });

  it('contains no backtick, which would close the TypeScript literal it lives in', () => {
    const body = /NBAI_EOF'\n([\s\S]*?)\nNBAI_EOF/.exec(script)?.[1] ?? '';
    expect(body).not.toContain('`');
  });

  it('reloads the page before believing the item was saved', () => {
    // Without the reload this whole module measures nothing that the render check did not already.
    expect(script).toContain('page.reload(');
    expect(script).toContain('vanished on reload');
  });

  it('defaults every journey to UNREACHABLE, so an unrun journey is never a failure', () => {
    expect(script).toContain("verdict: 'unreachable'");
  });

  it('the base url is normalised and json-encoded, never concatenated raw', () => {
    expect(script).toContain('const base = "https://x.e2b.app"');
  });
});

describe('reading the results honestly', () => {
  const r = (o: Partial<JourneyResult>): JourneyResult => ({
    id: 'x', kind: 'create-persists', route: '/todos', verdict: 'passed', step: 'reload', note: '', errors: [], ...o,
  });

  it('parses the runner output', () => {
    const out = parseJourneyResults('noise\nNBAI_JOURNEY {"id":"a","kind":"form-submit","route":"/","verdict":"passed","step":"x","note":"n","errors":[]}\n');
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe('passed');
  });

  it('drops a truncated line instead of guessing what it said', () => {
    expect(parseJourneyResults('NBAI_JOURNEY {"id":"a","verd')).toEqual([]);
    expect(parseJourneyResults(null)).toEqual([]);
  });

  it('THE HEADLINE for a losing-data app leads with what the user would feel', () => {
    const s = summarizeJourneys([r({ verdict: 'failed', note: 'the item appeared, then vanished on reload — it was never actually saved anywhere' })]);
    expect(s.ok).toBe(false);
    expect(s.summary).toContain('looks like it saves data but does not');
  });

  it('an UNREACHABLE journey never makes a working build look broken', () => {
    // We learned nothing. Saying nothing is the correct thing to do with nothing.
    const s = summarizeJourneys([r({ verdict: 'unreachable', note: 'could not reach this journey' })]);
    expect(s.ok).toBe(true);
    expect(s.summary).toContain('NOT counted');
  });

  it('says plainly when nothing ran at all', () => {
    expect(summarizeJourneys([])).toEqual({ ok: true, summary: 'No user journey was run.' });
  });

  it('a pass says what was actually proven, not that the app is correct', () => {
    expect(summarizeJourneys([r({})]).summary).toContain('filled in a real form in a real browser');
  });

  it('explains a quiet result rather than leaving it quiet', () => {
    expect(noJourneyReason({})).toContain('no page components');
    expect(noJourneyReason({ 'src/pages/A.tsx': '<div>hi</div>' })).toContain('no form');
    expect(noJourneyReason({ 'src/pages/A.tsx': '<input className="x" />' })).toContain('address honestly');
  });
});

describe('rendersList', () => {
  it('recognises a list rendered from data', () => {
    expect(rendersList('{items.map((t) => (<li>{t.title}</li>))}')).toBe(true);
  });

  it('does not call a page with no list a list', () => {
    expect(rendersList('<div>Hello</div>')).toBe(false);
  });
});

/** The wiring — a derivation nobody runs measures nothing. */
describe('it is actually wired into a build', () => {
  const routes = require('fs').readFileSync(
    require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8',
  ) as string;

  it('the journeys are derived and run against the real preview', () => {
    expect(routes).toContain('deriveJourneys(');
    expect(routes).toContain('journeyScript(');
    expect(routes).toContain('parseJourneyResults(');
  });

  it('the verdict reaches the report both ways', () => {
    expect(routes).toContain('JOURNEY_PASSED');
    expect(routes).toContain('JOURNEY_FAILED');
  });

  it('it is evidence, never a gate — a working build is not failed by a probe', () => {
    const at = routes.indexOf('JOURNEY_FAILED');
    expect(at).toBeGreaterThan(-1);
    expect(routes.slice(at - 1200, at + 600)).not.toContain('result.ok = false');
  });

  it('there is a kill switch', () => {
    expect(routes).toContain('AGENTV3_JOURNEY_CHECK');
  });
});
