import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decideBackAction, HARDWARE_BACK_EVENT, type BackState } from '../src/lib/androidBack';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Source with comments stripped. A negative assertion ("this call is gone") is otherwise defeated by
 * the comment that EXPLAINS why it is gone — the history of a fix must not be able to fail its own
 * test, and deleting the explanation to satisfy a matcher would be the wrong repair.
 */
const readCode = (p: string) => read(p)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*(\/\/|\s\*).*$/gm, '');

/**
 * THE REPORTED BUG (admin 2026-09-17): *"jab bhi koi user kisi bhi page par apne android mobile se
 * back button press karta hai, app band ho jati hai"* — Back closed the app from every screen,
 * because the old handler asked the WebView whether it could go back and this app never puts
 * anything in the WebView's history. These pin the replacement behaviour the admin asked for:
 * any page → Home, and Home → ask before leaving.
 */
const base: BackState = { exitPromptOpen: false, openOverlays: [], isHome: false };

describe('decideBackAction — what one Back press means', () => {
  it('THE BUG ITSELF: Back on an inner page goes HOME, it does not close the app', () => {
    expect(decideBackAction({ ...base, isHome: false })).toEqual({ type: 'go-home' });
  });

  it('Back on HOME asks before leaving — it never exits silently', () => {
    expect(decideBackAction({ ...base, isHome: true })).toEqual({ type: 'confirm-exit' });
  });

  it('Back while the exit dialog is open CANCELS it — Back must never confirm leaving', () => {
    // Every Android app dismisses a confirmation with Back. If this ever returned confirm-exit, two
    // quick Back presses would close the app without the user reading a word of the question.
    for (const isHome of [true, false]) {
      expect(decideBackAction({ ...base, isHome, exitPromptOpen: true }))
        .toEqual({ type: 'dismiss-exit-prompt' });
    }
  });

  it('an open overlay is closed first — jumping Home from a sheet would throw away the user\'s work', () => {
    expect(decideBackAction({ ...base, openOverlays: ['menu'] }))
      .toEqual({ type: 'close-overlay', id: 'menu' });
    // …and that holds on Home too, where the alternative would be asking to exit over an open sheet.
    expect(decideBackAction({ ...base, isHome: true, openOverlays: ['auth'] }))
      .toEqual({ type: 'close-overlay', id: 'auth' });
  });

  it('closes the TOPMOST overlay, which is the last one in the list', () => {
    expect(decideBackAction({ ...base, openOverlays: ['menu', 'report', 'auth'] }))
      .toEqual({ type: 'close-overlay', id: 'auth' });
  });

  it('the exit dialog outranks everything — it is the layer physically on top', () => {
    expect(decideBackAction({ exitPromptOpen: true, openOverlays: ['menu', 'auth'], isHome: true }))
      .toEqual({ type: 'dismiss-exit-prompt' });
  });

  it('is TOTAL — every input yields an action, because a Back that does nothing traps the user', () => {
    const inputs: BackState[] = [
      base,
      { ...base, isHome: true },
      { ...base, openOverlays: ['x'] },
      { ...base, exitPromptOpen: true },
      // Shapes a caller could genuinely assemble by accident from a dozen booleans:
      { exitPromptOpen: false, openOverlays: ['', '  '], isHome: false },
      { exitPromptOpen: false, openOverlays: [undefined as never, null as never], isHome: true },
      ...[undefined, null, {}].map((bad) => bad as never as BackState),
    ];
    for (const input of inputs) {
      const action = decideBackAction(input);
      expect(action).toBeTruthy();
      expect(['dismiss-exit-prompt', 'close-overlay', 'go-home', 'confirm-exit']).toContain(action.type);
      if (action.type === 'close-overlay') expect(action.id.length).toBeGreaterThan(0);
    }
  });

  it('never returns an EMPTY overlay id — an id with no closer is a Back press that does nothing', () => {
    // A hole in the list must be skipped, not obeyed. With nothing usable left it falls through to
    // the ordinary decision rather than emitting an instruction the caller cannot act on.
    expect(decideBackAction({ ...base, openOverlays: ['', '   '] })).toEqual({ type: 'go-home' });
    expect(decideBackAction({ ...base, isHome: true, openOverlays: [''] })).toEqual({ type: 'confirm-exit' });
    expect(decideBackAction({ ...base, openOverlays: ['menu', ''] }))
      .toEqual({ type: 'close-overlay', id: 'menu' });
  });
});

describe('the wiring, so the decision cannot be stranded', () => {
  it('the native shell no longer exits on its own — the removed line was the bug', () => {
    const shell = read('src/lib/nativeShell.ts');
    // The exact old rule: `canGoBack === false` → exitApp, inside the backButton listener.
    expect(shell).not.toContain('data?.canGoBack === false && ctx.App?.exitApp');
    // exitApp survives, but only behind the one named function the user's confirmation reaches.
    expect(shell).toContain('export function exitNativeApp');
  });

  it('main.tsx forwards the press to the app instead of calling history.back()', () => {
    const main = readCode('src/main.tsx');
    expect(main).toContain('HARDWARE_BACK_EVENT');
    // history.back() could never work here: nothing in this app ever pushes a history entry.
    expect(main).not.toContain('window.history.back()');
  });

  it('App.tsx answers that event and renders the confirmation', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('decideBackAction(');
    expect(app).toContain(`window.addEventListener(HARDWARE_BACK_EVENT`);
    expect(app).toContain('<ExitConfirmDialog');
    // Every action the decision can return must have a branch here, or Back silently does nothing.
    for (const branch of ['dismiss-exit-prompt', 'close-overlay', 'go-home', 'confirm-exit']) {
      expect(app).toContain(`case '${branch}'`);
    }
  });

  it('the event name is shared, never retyped at either end', () => {
    expect(HARDWARE_BACK_EVENT).toBe('navbharat:hardware-back');
    for (const f of ['src/main.tsx', 'src/App.tsx']) {
      // A literal string on one side is how these two quietly stop talking to each other.
      expect(read(f)).not.toContain("'navbharat:hardware-back'");
    }
  });
});

describe('the exit dialog says what the admin asked for', () => {
  const dlg = read('src/components/ExitConfirmDialog.tsx');

  it('offers exactly Exit (red) and Cancel (gray), in English', () => {
    // Whitespace-tolerant: these are JSX children on their own lines, not inline text nodes.
    expect(dlg).toMatch(/>\s*Exit\s*<\/button>/);
    expect(dlg).toMatch(/>\s*Cancel\s*<\/button>/);
    expect(dlg).toContain('bg-red-600');    // Exit — destructive, a fixed brand red on every theme
    // ⚠️ SUPERSEDED 2026-09-21: `bg-white/10` → `bg-raised`. The INVARIANT this case tests is that
    // Cancel is the calm one and Exit the destructive one, and it still holds — `bg-raised` IS the
    // calm surface, now themed instead of a white wash that only worked on a dark ground.
    expect(dlg).toContain('bg-raised');     // Cancel — calm
    expect(dlg).not.toContain('bg-red-600 hover:bg-red-500 text-white');   // Exit's label rides the fill
    expect(dlg).toContain('Exit NavBharatAI?');
  });

  it('CANCEL takes the focus, so a stray Enter keeps the user in the app', () => {
    expect(dlg).toContain('cancelRef.current?.focus()');
  });

  it('the backdrop does not dismiss — an accidental tap must not answer the question', () => {
    // Deliberately no onClick on the backdrop. If one is ever added, this fails and the reasoning
    // in the component header has to be revisited rather than silently overridden.
    const backdrop = dlg.slice(dlg.indexOf('fixed inset-0'), dlg.indexOf('role="alertdialog"'));
    expect(backdrop).not.toContain('onClick');
  });
});
