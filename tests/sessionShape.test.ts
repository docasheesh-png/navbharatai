import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { messagesOf, shapeSession, shapeSessions } from '../src/lib/sessionShape';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * Source with COMMENTS REMOVED, for every "this pattern must be gone" assertion.
 *
 * Written after the same mistake three times in one day: a fix's own comment quotes the bad pattern it
 * is explaining, so a whole-file `not.toContain` fails on the explanation instead of on the code. The
 * property under test is what the RUNTIME sees, and the runtime never sees a comment.
 */
function codeOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
}


describe('THE REPORTED CRASH: messages that exist but are not an array', () => {
  // "I.find is not a function. (In 'I.find(h=>h.sender==="user")', 'I.find' is undefined)"
  // Note WHICH error: not "cannot read property of undefined". The object was there; `.find` was not.
  it('a Firestore MAP does not kill the screen — and its messages are recovered, not discarded', () => {
    const session = { id: 's1', messages: { 0: { sender: 'user', text: 'hi' }, 1: { sender: 'ai', text: 'yo' } } };
    const msgs = messagesOf(session);
    expect(Array.isArray(msgs)).toBe(true);
    // Recovering it is the difference between "no longer fatal" and "fixed": the user sees their real
    // conversation title instead of "New Conversation".
    expect(msgs.find((m) => m.sender === 'user')?.text).toBe('hi');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'not messages'],
    ['a number', 42],
    ['an empty object', {}],
    ['a settings-shaped object', { theme: 'dark', fontSize: 14 }],
  ])('%s becomes an empty array rather than a crash', (_label, messages) => {
    const msgs = messagesOf({ id: 's', messages });
    expect(Array.isArray(msgs)).toBe(true);
    expect(() => msgs.find((m) => m.sender === 'user')).not.toThrow();
  });

  it('a settings-shaped object is NOT turned into rows the user never wrote', () => {
    expect(messagesOf({ messages: { theme: 'dark', fontSize: 14 } })).toEqual([]);
  });

  it('a real array passes through by IDENTITY — the normal path costs nothing', () => {
    const messages = [{ sender: 'user', text: 'hi' }];
    const session = { id: 's', messages };
    expect(messagesOf(session)).toBe(messages);
    expect(shapeSession(session)).toBe(session);   // no new object, so no needless re-render
  });

  it('the LIST itself can be the wrong shape too — JSON.parse returns whatever is on the device', () => {
    expect(shapeSessions(null)).toEqual([]);
    expect(shapeSessions({ a: 1 })).toEqual([]);
    expect(shapeSessions('[]')).toEqual([]);
    expect(shapeSessions([null, 'x', { id: 'ok' }])).toHaveLength(1);
  });

  it('never throws, on anything', () => {
    for (const v of [undefined, null, 0, '', [], {}, NaN, Symbol('x'), () => {}]) {
      expect(() => messagesOf(v)).not.toThrow();
      expect(() => shapeSessions(v)).not.toThrow();
    }
  });
});

describe('the shape is fixed AT THE DOOR, not at each reader', () => {
  const history = read('src/components/HistoryView.tsx');

  it('both session sources are normalized as they arrive', () => {
    // Firestore and localStorage. Neither is under our control at read time.
    expect(history).toContain('shapeSessions(snapshot.docs.map(');
    expect(history).toContain("shapeSessions(JSON.parse(localStorage.getItem('navbharat_sessions')");
  });

  it('the crash site reads the normalized value', () => {
    expect(history).toContain("messagesOf(session).find((m) => m.sender === 'user')");
    expect(codeOf(history)).not.toContain("session.messages?.find(");
  });

  it('NO READER IS LEFT WITH ITS OWN PRIVATE GUARD — that asymmetry is what hid the bug', () => {
    // The search filter had `Array.isArray(s.messages)` twelve lines from the crash. One reader
    // defended, one not, in the same file. Leaving the old guard would keep implying the field is
    // untrusted here and safe there.
    expect(codeOf(history)).not.toContain('Array.isArray(s.messages)');
  });

  it('the SIBLING found by grepping the same storage key is fixed too', () => {
    // `JSON.parse(raw) as ChatSession[]` is a cast, not a check: TypeScript satisfied, runtime not.
    const analytics = read('src/components/ide/AppAnalytics.tsx');
    expect(analytics).toContain('shapeSessions(JSON.parse(raw))');
    expect(codeOf(analytics)).not.toContain('JSON.parse(raw) as ChatSession[]');
  });
});

describe('the error screen must not be a trap', () => {
  const boundary = read('src/components/ErrorBoundary.tsx');

  it('a failed retry stops offering the move that just failed, and offers a real way out', () => {
    // "kitna bhi re try karo, kuch nahi hota — app band karni padti hai." Try Again cleared a flag and
    // re-rendered the SAME children with the SAME data; for a deterministic crash that can only fail.
    expect(boundary).toContain('this.state.retries === 0');
    expect(boundary).toContain('Retrying did not help');
    expect(boundary).toContain('Go to the home page');
  });

  it("the escape leaves the CRASHING VIEW, not just the state — views live in the query string", () => {
    // A plain location.reload() would land straight back on the screen that broke.
    expect(boundary).toContain("window.location.href = '/'");
    expect(codeOf(boundary)).not.toContain('window.location.reload()');
  });

  it('the retry count SURVIVES the error, or the escape could never appear', () => {
    // A full State return would reset retries on every crash, so the second screen would look like the
    // first forever and the escape would be unreachable.
    expect(boundary).toContain('Partial<State>');
    const derived = codeOf(boundary).slice(codeOf(boundary).indexOf('getDerivedStateFromError'));
    expect(derived.slice(0, derived.indexOf('}') + 1)).not.toContain('retries');
    expect(boundary).toContain("retries: 0");   // …only the initial state sets it
  });

  it('a repeat failure is reported as a repeat, so it reads as trapping someone', () => {
    expect(boundary).toContain('retries: this.state.retries');
  });
});
