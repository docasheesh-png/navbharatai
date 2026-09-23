import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 LONG-PRESS IN THE APP IS NOT LONG-PRESS ON A WEB PAGE (admin 2026-09-23, phone screenshot of the
 * home screen: the tagline highlighted with selection handles and iOS's "Copy · Look Up · Translate"
 * bubble over the cards) — "kisi text par long press karo to woh copy hone lagta hai, 'website
 * behaviour'. isko hatao, app jaisa banao. website me abhi jaisa rahne dena."
 *
 * WHAT THE FIX ACTUALLY CHANGED, because a rule for this already existed and was not the fix. The old
 * rule named four things — button, [role='button'], nav, header, footer — and the text in the
 * screenshot is a plain <p> in HomeView, inside neither. So is every heading, card title and line of
 * body copy. An allowlist of CHROME cannot be completed against an open-ended set of tags, so inside
 * the shell the question is inverted: nothing is selectable unless the allow list names it.
 *
 * Three things are locked, and each one is a way the change could silently become wrong:
 *
 * 1. THE DENY EXISTS AND IS GATED ON THE SHELL. Ungated, it would take selection away from the
 *    WEBSITE, which the same message explicitly ruled out.
 * 2. THE ALLOW LIST STILL CARRIES THE PLACES SELECTION IS A FEATURE. An input a user cannot select is
 *    an input they cannot correct (and in a WKWebView the caret handles go with it), and a chat reply,
 *    generated code, the terminal and the legal pages must stay copyable. This is the "never trade one
 *    problem for another" half — the failure mode it guards against ships as a WORKING app that
 *    quietly cannot be copied from.
 * 3. THE DENY IS NOT A UNIVERSAL SELECTOR. `user-select` inherits, so the deny belongs on <html> at
 *    (0,1,1) and every allow rule below is (0,1,2) and wins on its own subtree. Written as
 *    `html.nb-native-shell *` the deny would be (0,1,1) on EVERY descendant and would beat all of
 *    them — turning point 2 off with no test failing anywhere. That is the reversion this file exists
 *    to catch, and it is invisible to both tsc and every behavioural test in this repo.
 */

const root = process.cwd();
const css = readFileSync(join(root, 'src/index.css'), 'utf8');

/** CSS with comments stripped — a rule must never be "found" inside the prose that explains it. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block that follows a selector list containing `needle`, or null. */
function blockAfter(source: string, needle: string): string | null {
  const at = source.indexOf(needle);
  if (at === -1) return null;
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return source.slice(open + 1, close);
}

describe('the app does not select text like a website', () => {
  it('denies selection and the iOS callout inside the native shell', () => {
    const block = blockAfter(rules, 'html.nb-native-shell {');
    expect(block, 'no `html.nb-native-shell { … }` selection rule found').not.toBeNull();
    expect(block).toMatch(/-webkit-user-select:\s*none/);
    expect(block).toMatch(/[^-]user-select:\s*none/);
    expect(block).toMatch(/-webkit-touch-callout:\s*none/);
  });

  it('never denies selection outside the shell — the website keeps today\'s behaviour', () => {
    // Every `user-select: none` declaration that reaches the whole document must be shell-gated. A
    // rule on a named element (button, nav, …) is fine and predates this change; a rule on html or
    // body is not, because it would land on every visitor to navbharatai.com.
    const globalDeny = /(^|})\s*(html|body)[^{}]*\{[^}]*user-select:\s*none/g;
    for (const match of rules.matchAll(globalDeny)) {
      expect(match[0], 'a document-wide `user-select: none` that is not gated on the native shell')
        .toContain('nb-native-shell');
    }
  });

  it('keeps selection where it is a feature, not an accident', () => {
    const selector = rules.slice(rules.indexOf('html.nb-native-shell input'));
    const head = selector.slice(0, selector.indexOf('{'));
    // Fields first: without these an input cannot be corrected, and iOS drops the caret handles too.
    for (const must of ['input', 'textarea', 'contenteditable']) {
      expect(head, `selection must stay on ${must}`).toContain(must);
    }
    // Then the app's own content hooks — the wrappers the chat surfaces, code views, terminal, editor
    // and opt-in content blocks already render.
    for (const must of ['pre', 'code', '.prose', '.markdown-body', '.xterm', '.monaco-editor', '.nb-selectable']) {
      expect(head, `selection must stay on ${must}`).toContain(must);
    }
    const block = blockAfter(rules, 'html.nb-native-shell input');
    expect(block).toMatch(/-webkit-user-select:\s*text/);
    expect(block).toMatch(/[^-]user-select:\s*text/);
    expect(block).toMatch(/-webkit-touch-callout:\s*default/);
  });

  it('REVERSION GUARD: the deny is never written as a universal selector', () => {
    // `html.nb-native-shell * { user-select: none }` would be (0,1,1) on every descendant and would
    // beat every allow rule above — chat replies, code, the terminal and the legal pages would all
    // become uncopyable, and nothing else in this repo would fail.
    const universal = /html\.nb-native-shell\s*\*[^{}]*\{[^}]*user-select:\s*none/;
    expect(universal.test(rules), 'the deny must inherit from <html>, never match every descendant')
      .toBe(false);
  });

  it('the gate is set before first paint, and only when the Capacitor bridge is present', () => {
    // The class this whole file keys on is added by index.html's pre-paint script. If that ever became
    // conditional on something else — or ran after React mounts — the website would inherit the app's
    // behaviour, or the app would show one frame of the website's.
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain("classList.add('nb-native-shell')");
    const at = html.indexOf("classList.add('nb-native-shell')");
    expect(html.slice(Math.max(0, at - 400), at)).toContain('window.Capacitor');
  });

  it('the content blocks that use no other hook carry the opt-in class', () => {
    // These three render an answer or a document through none of `.prose` / `.markdown-body` / `pre`,
    // so without `nb-selectable` the deny above would make them uncopyable in the app. Asserted by
    // file because that is the exact regression the allow list exists to prevent.
    const cases: Array<[string, string]> = [
      ['src/components/agentv3/AgentV3Panel.tsx', 'nb-selectable'],
      ['src/components/professionals/ProfessionalChat.tsx', 'nb-selectable'],
      ['src/components/panels/LegalDocPage.tsx', 'nb-selectable'],
    ];
    for (const [path, needle] of cases) {
      expect(readFileSync(join(root, path), 'utf8'), `${path} lost its ${needle} hook`).toContain(needle);
    }
  });
});
