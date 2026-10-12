/**
 * 🚪 NO APP ON EARTH LABELS A BUTTON "auth" — autopsy `39e982bd`, Q-514 and Q-517.
 *
 * `JOURNEY_NOT_RUN` → **RELEASE_GATE YELLOW**: *"whether it keeps what a user enters is untested"*.
 * The one journey the engine derived was the sign-in form in `src/screens/AuthScreen.tsx`, and the
 * control it went looking for was named **`auth`** — the word the FILE carries. The report's own
 * sentence: *"no visible control named after the \"auth\" screen was found to open it"*. Every app with
 * a login screen is in that shape, so a correct app is told its saving is untested.
 *
 * 🔑 THE GENERAL HALF IS NOT A SYNONYM TABLE, and it matters more than the table. A file's word is
 * CONCATENATED (`login`, `checkout`, `signup`) while a control's label is SPACED (`Log in`,
 * `Check out`), and the runner matched with `includes` — **`"log in".includes("login")` is `false`**.
 * No list of synonyms could ever have bridged that; comparing the LETTERS alone fixes `login`/`Log in`
 * for every screen and needs no list.
 *
 * 🔒 THE TABLE IS THE REMAINDER: one entry, for the one word no user-facing control carries at all.
 * And its aliases are only the NON-CREATING doors — "sign in", "log in", "login". "Sign up",
 * "Register" and "Create account" are in `WRITE_VERBS`, so `pressReach` refuses them anyway (pressing
 * one could create an account), and listing them would be noise that can never fire. A screen whose
 * only door is "Sign up" stays unreachable, correctly.
 *
 * ── Q-517, the same report ──────────────────────────────────────────────────────────────────────────
 * `READINESS_WARNING: "No tests at all"` was recorded at 19:30:09, and `E2E_SCAFFOLDED` wrote a
 * Playwright suite **17 seconds later**. By the time the user read the report the sentence was false,
 * and `TEST_SUITE_UNVERIFIED` in the same report said the opposite. The scaffold pass now clears that
 * warning — **by its own sentence, never by its code**: `READINESS_WARNING` carries many unrelated
 * facts ("Requested feature not found: search", …) and clearing the code would silence them too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  reachAliasesFor,
  reachWordFor,
  journeyScript,
  type Journey,
} from '../src/server/AgentV3/journeyDerivation';
import { WRITE_VERBS } from '../src/server/AgentV3/clickExplorer';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

describe('🚪 the door the user sees, not the word the file carries', () => {
  it('gives the report\'s own screen the words a real control carries', () => {
    expect(reachWordFor('src/screens/AuthScreen.tsx')).toBe('auth');
    expect(reachAliasesFor('auth')).toEqual(['sign in', 'log in', 'login']);
    expect(reachAliasesFor('authentication')).toEqual(['sign in', 'log in', 'login']);
  });

  it('offers nothing for an ordinary screen — the table is a remainder, not a vocabulary', () => {
    for (const w of ['design', 'settings', 'profile', 'cart', 'revenue', 'wallet', 'matches', null, undefined, '']) {
      expect(reachAliasesFor(w as string), String(w)).toEqual([]);
    }
  });

  it('offers only the doors that can be pressed — a creating door is refused anyway', () => {
    // `pressReach` skips any name matching WRITE_VERBS, so an alias it would refuse is noise.
    for (const alias of reachAliasesFor('auth')) expect(WRITE_VERBS.test(alias), alias).toBe(false);
    for (const creating of ['sign up', 'register', 'create account']) expect(WRITE_VERBS.test(creating), creating).toBe(true);
  });
});

describe('🔤 the runner compares letters, so a spaced label matches a joined word', () => {
  const journey = (reach: string, reachAlso?: readonly string[]): Journey => ({
    id: `form-submit:src/screens/X.tsx`,
    kind: 'form-submit',
    route: '/',
    reach,
    ...(reachAlso ? { reachAlso } : {}),
    title: 't',
    fields: [{ target: { kind: 'label', value: 'Email' }, value: 'a@b.c' }],
    submit: { kind: 'text', value: 'Submit' },
    writes: true,
  });

  /** The exact comparison the generated module makes, lifted from it rather than restated. */
  const matcher = (): ((label: string, words: readonly string[]) => boolean) => {
    const letters = (x: string) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return (label, words) => words.some((w) => letters(label).includes(letters(w)));
  };

  it('is why the old substring match could never work', () => {
    // The measurement the fix rests on.
    expect('log in'.includes('login')).toBe(false);
    expect('sign up'.includes('signup')).toBe(false);
    expect('check out'.includes('checkout')).toBe(false);
  });

  it('matches a spaced label for every screen, with no list involved', () => {
    const m = matcher();
    expect(m('Log in', ['login'])).toBe(true);
    expect(m('Check out', ['checkout'])).toBe(true);
    expect(m('Sign Up', ['signup'])).toBe(true);
  });

  it('matches the report\'s own door through the aliases', () => {
    const m = matcher();
    const words = ['auth', ...reachAliasesFor('auth')];
    for (const label of ['Sign in', 'Sign In', 'Log in', 'Login', 'LOG IN', 'Log In →']) {
      expect(m(label, words), label).toBe(true);
    }
  });

  it('does not start matching things it should not', () => {
    const m = matcher();
    expect(m('Delete account', ['auth', ...reachAliasesFor('auth')])).toBe(false);
    expect(m('Settings', ['design'])).toBe(false);
    expect(m('Matches', ['wallet'])).toBe(false);
  });

  it('carries both the word and its aliases into the generated module, which parses', () => {
    const src = journeyScript('http://x', [journey('auth', reachAliasesFor('auth'))], 'MK');
    expect(src).toContain('reach: "auth"');
    expect(src).toContain('reachAlso: ["sign in","log in","login"]');
    expect(src).toContain('letters(x).includes(letters(w))');
    // A generated script is code, and this one has shipped broken before (a backtick in a comment,
    // a `\b` that reached the page as a backspace). Parse the real thing with the real parser.
    const inner = /<<'NBAI_EOF'\n([\s\S]*?)\nNBAI_EOF/.exec(src)?.[1] ?? src;
    const tmp = join(process.cwd(), 'node_modules/.cache');
    try { execFileSync('mkdir', ['-p', tmp]); } catch { /* best-effort */ }
    const f = join(tmp, 'nbai-journey-check.mjs');
    writeFileSync(f, inner);
    expect(() => execFileSync(process.execPath, ['--check', f])).not.toThrow();
  });

  it('says which words it looked for when it cannot find the door', () => {
    const src = journeyScript('http://x', [journey('auth', reachAliasesFor('auth'))], 'MK');
    expect(src).toContain("'no visible control named after the \"' + j.reach + '\" screen was found to open it (looked for: ' + reachWords.join(', ') + ')'");
  });

  it('omits reachAlso entirely for a screen with no aliases', () => {
    const src = journeyScript('http://x', [journey('design')], 'MK');
    expect(src).toContain('reachAlso: []');
  });
});

describe('🧪 "No tests at all" stops being said once a suite has been written', () => {
  it('clears that warning by its own sentence', () => {
    const d = new BuildDiagnostics('b', 'ws');
    d.record({ phase: 'readiness', severity: 'warning', code: 'READINESS_WARNING', message: 'No tests at all' });
    expect(d.resolveOnRecheck('READINESS_WARNING', { messageIncludes: 'No tests at all' })).toBe(1);
    const issue = d.report().issues.find((i) => i.code === 'READINESS_WARNING');
    expect(issue?.autoResolved).toBe(true);
  });

  it('leaves every OTHER readiness warning exactly as it was', () => {
    // The precision lock: READINESS_WARNING carries many unrelated facts, and clearing the CODE would
    // silence a real "Requested feature not found" in the same build.
    const d = new BuildDiagnostics('b', 'ws');
    d.record({ phase: 'readiness', severity: 'warning', code: 'READINESS_WARNING', message: 'No tests at all' });
    d.record({ phase: 'readiness', severity: 'warning', code: 'READINESS_WARNING', message: 'Requested feature not found: search' });
    expect(d.resolveOnRecheck('READINESS_WARNING', { messageIncludes: 'No tests at all' })).toBe(1);
    const open = d.report().issues.filter((i) => i.code === 'READINESS_WARNING' && i.autoResolved !== true);
    expect(open).toHaveLength(1);
    expect(open[0].message).toContain('Requested feature not found');
  });

  it('keeps the whole-code behaviour every existing caller relies on', () => {
    const d = new BuildDiagnostics('b', 'ws');
    d.record({ phase: 'preview', severity: 'warning', code: 'EXPLORE_FAILED', message: 'a button broke the app' });
    d.record({ phase: 'preview', severity: 'warning', code: 'EXPLORE_FAILED', message: 'another one did too' });
    expect(d.resolveOnRecheck('EXPLORE_FAILED')).toBe(2);
  });

  it('is wired where the suite is written — a source guard', () => {
    // The ordering is the whole defect: readiness runs first, the scaffold second, and nothing but a
    // call at the scaffold can know the sentence became false.
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const at = src.indexOf("code: 'E2E_SCAFFOLDED'");
    expect(at).toBeGreaterThan(-1);
    const after = src.slice(at, at + 1800);
    // Since db07e0af: withdrawn, because `resolveOnRecheck` skips a warning born resolved (see the next block).
    expect(after).toContain("buildDiag.retract('READINESS_WARNING', 'No tests at all',");
    expect(after).not.toContain("resolveOnRecheck('READINESS_WARNING'");
  });
});

describe('🧪 …through the REAL recorder (autopsy db07e0af — the fix above never fired in a build)', () => {
  // The readiness gate's warnings reach the report through the runner's `done` event, recorded ALREADY
  // resolved. The tests above record the warning by hand, unresolved, which is why they passed while every real
  // report kept "No tests at all" beside E2E_SCAFFOLDED.
  const viaDone = () => {
    const d = new BuildDiagnostics('b', 'ws');
    d.ingestEvent({ type: 'done', ok: true, summary: 'built', readiness: { blockers: [], warnings: ['1 component(s) created but never used: src/components/LoadingSpinner.tsx (LoadingSpinner)', 'No tests at all'] } } as never);
    return d;
  };
  it('the real recorder records it resolved — which is why resolving it again changed nothing', () => {
    const d = viaDone();
    expect(d.report().issues.find((i) => i.message === 'No tests at all')?.autoResolved).toBe(true);
    expect(d.resolveOnRecheck('READINESS_WARNING', { messageIncludes: 'No tests at all' })).toBe(0);
    expect(d.report().problems.map((p) => p.message)).toContain('No tests at all');
  });
  it('withdrawn, it leaves the problems list and says why on the timeline', () => {
    const d = viaDone();
    expect(d.retract('READINESS_WARNING', 'No tests at all', 'an end-to-end suite was written (e2e/smoke.spec.ts)')).toBe(1);
    const r = d.report();
    expect(r.problems.map((p) => p.message)).not.toContain('No tests at all');
    const kept = r.issues.find((i) => i.message === 'No tests at all');
    expect(kept?.severity).toBe('info');
    expect(kept?.detail).toContain('Withdrawn — an end-to-end suite was written');
  });
  it('the other readiness warning in the same build stands', () => {
    const d = viaDone();
    d.retract('READINESS_WARNING', 'No tests at all', 'x');
    expect(d.report().problems.map((p) => p.message)).toContain('1 component(s) created but never used: src/components/LoadingSpinner.tsx (LoadingSpinner)');
  });
});
