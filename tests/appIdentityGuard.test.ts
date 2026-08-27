import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  shapeConflict, stillDescribes, readIfCurrent, conflictNote, type AppShape,
} from '../src/server/AgentV3/appIdentity';

/**
 * THE GUARD FOR THE CLASS — "a stored answer must still be ABOUT the app that is here now."
 *
 * Seven bugs in two days shared one shape: a stored answer describing an app, read later while
 * looking at a DIFFERENT app (#2658 the live URL / publish message / publish state / celebration;
 * #2662 the preview recipe's port / the previous app's dev server / the framework badge). The worst
 * of them told the admin their UPI API build had produced a piano.
 *
 * ⚠️ These tests also pin the correction to MY OWN first design. PROGRESS.md proposed stamping every
 * record with the buildId — which changes on every build, so a one-line edit would have thrown away
 * a working app's live URL and preview recipe. The fingerprint is of the app's SHAPE (what kind of
 * thing it is and how it runs), never its content.
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('shapeConflict — a different app, not a changed one', () => {
  it('🔒 THE PIANO: a Vite app’s recipe against an Express app', () => {
    expect(shapeConflict(
      { framework: 'vite-react', devCommand: 'npm run dev', port: 5173 },
      { framework: 'node-express', devCommand: 'npm run server:dev', port: 3000 },
    )).toBe('framework');
  });

  it('names the STRONGEST evidence, so the report line is honest rather than incidental', () => {
    // Framework outranks command, command outranks port.
    expect(shapeConflict({ devCommand: 'npm run dev', port: 5173 }, { devCommand: 'npm start', port: 3000 })).toBe('devCommand');
    expect(shapeConflict({ devCommand: 'npm run dev', port: 5173 }, { devCommand: 'npm run dev', port: 3000 })).toBe('port');
  });

  it('🔒 AN EDIT IS NOT A DIFFERENT APP — the whole point of fingerprinting shape', () => {
    // This is the case my buildId proposal would have got wrong: same app, edited, must be kept.
    const same: AppShape = { framework: 'vite-react', devCommand: 'npm run dev', port: 5173 };
    expect(shapeConflict(same, { ...same })).toBe('');
    expect(stillDescribes(same, { ...same })).toBe(true);
  });

  it('🔒 SILENCE IS NEVER A CONFLICT — an unknown field cannot disagree', () => {
    // If unsure meant discard, every preview whose framework we failed to read would lose its proven
    // recipe and fall back to guessing — a rare wrong-app bug traded for a common slow-preview one.
    expect(shapeConflict({ framework: 'vite-react' }, {})).toBe('');
    expect(shapeConflict({}, { framework: 'node-express' })).toBe('');
    expect(shapeConflict({ port: 5173 }, { port: null })).toBe('');
    expect(shapeConflict({ framework: '  ' }, { framework: 'node-express' })).toBe('');
    expect(shapeConflict(null, { framework: 'x' })).toBe('');
    expect(shapeConflict({ framework: 'x' }, undefined)).toBe('');
  });

  it('compares forgivingly — case and spacing are not a different app', () => {
    expect(shapeConflict({ devCommand: 'npm  run   dev' }, { devCommand: 'NPM RUN DEV' })).toBe('');
  });

  it('a nonsense port is unknown, not a disagreement', () => {
    expect(shapeConflict({ port: 0 }, { port: 3000 })).toBe('');
    expect(shapeConflict({ port: 99999 }, { port: 3000 })).toBe('');
  });
});

describe('readIfCurrent — forgetting becomes impossible, not merely discouraged', () => {
  it('returns the value while it still describes this app', () => {
    const rec = { shape: { port: 3000 }, value: 'https://3000-x.e2b.app' };
    expect(readIfCurrent(rec, { port: 3000 })).toBe('https://3000-x.e2b.app');
  });

  it('🔒 returns null the moment it describes another one', () => {
    const rec = { shape: { framework: 'vite-react' }, value: 'piano' };
    expect(readIfCurrent(rec, { framework: 'node-express' })).toBeNull();
  });

  it('a missing record is null, never a throw', () => {
    expect(readIfCurrent(null, { port: 3000 })).toBeNull();
    expect(readIfCurrent(undefined, { port: 3000 })).toBeNull();
  });

  it('an unshaped record is kept — silence again, so adopting this cannot break old data', () => {
    expect(readIfCurrent({ value: 'v' }, { port: 3000 })).toBe('v');
  });
});

describe('conflictNote — names the evidence, never just "stale"', () => {
  it('says what was, what is, and that nothing from the old app will be shown', () => {
    const note = conflictNote('port', 'The saved preview settings', { port: 5173 }, { port: 3000 });
    expect(note).toContain('5173');
    expect(note).toContain('3000');
    expect(note).toContain('previous app');
  });

  it('reads devCommand in the user’s words, not ours', () => {
    expect(conflictNote('devCommand', 'X', { devCommand: 'a' }, { devCommand: 'b' })).toContain('start command');
  });

  it('no conflict ⇒ no sentence', () => {
    expect(conflictNote('', 'X', {}, {})).toBe('');
  });
});

describe('🔒 the guard is WIRED at the line that served the piano', () => {
  const routes = src('src/server/routes/agentv3.ts');

  it('the door checks the recipe against what this app declares now', () => {
    expect(routes).toContain('const recipeConflict = shapeConflict(');
    expect(routes).toContain('const recipe = recipeConflict ? null : recipeRaw;');
  });

  it('it compares against declaredPort — the freshest statement, from the SAME document', () => {
    const at = routes.indexOf('const recipeConflict = shapeConflict(');
    const block = routes.slice(at, at + 400);
    expect(block).toContain('doorRecord?.declaredPort');
  });
});

/**
 * THE CENSUS — the half that makes this a guard rather than another fix.
 *
 * AgentV3Panel holds ~129 pieces of state; auditing all of them would be noise with no signal. The
 * DANGEROUS ones are specifically those tied to the workspace, and they are mechanically countable.
 * Same proven mechanism as the `writtenFiles` census in agentv3.test.ts: a new one changes the count,
 * CI fails, and whoever added it must state why it is safe — which is exactly the thought that was
 * missing all seven times.
 */
describe('workspace-scoped state census — a new one must be justified', () => {
  const panel = src('src/components/agentv3/AgentV3Panel.tsx');

  it('has exactly the audited set of effects keyed on the workspace', () => {
    const sole = (panel.match(/\[state\.workspaceId\]/g) ?? []).length;
    const leading = (panel.match(/\[state\.workspaceId,/g) ?? []).length;

    // Audited 2026-08-25. SOLE dependency (2× — both are the reset guards themselves):
    //   1× setLiveUrl(null) + setCelebration(null) — the reported leak (#2658).
    //   1× setPublishMsg('')  — its sibling, which names the other app's URL verbatim.
    // LEADING dependency (2×):
    //   1× the chat-history row writer — it WRITES to Firestore and holds no state describing the
    //      workspace, so there is nothing to leak. Considered ✓.
    //   1× the live-URL fetch — always assigns (null included), so "this app has no live site" can
    //      overwrite the previous app's answer. Considered ✓.
    //
    // ⚠️ IF YOU ADD ONE: state filled from a workspace-scoped response MUST also be cleared when the
    // workspace changes, in its own effect keyed on the id ALONE — before the fetch (or the old value
    // shows under the new app's name for the length of a round trip) and not on a build-finished dep
    // (or the UI blinks mid-build). Then update these numbers.
    //
    // 2026-08-27 (B6 checkpoint compare) — one of each, both audited:
    //   SOLE +1: the compare reset (compareMode/compareSel/compareResult) — this guard caught the
    //   leak on the first full-suite run; app A's diff would have rendered under app B's History.
    //   LEADING +1: runCompare — a fetch wrapper; its result state is cleared by the reset above. ✓
    expect(sole).toBe(3);
    expect(leading).toBe(3);
  });

  it('🔒 the known leaks stay closed', () => {
    expect(panel).toContain('useEffect(() => { setLiveUrl(null); setCelebration(null); }, [state.workspaceId]);');
    expect(panel).toContain("useEffect(() => { setPublishMsg(''); }, [state.workspaceId]);");
    expect(src('src/hooks/usePublishState.ts')).toContain('useEffect(() => { setState(null); }, [workspaceId]);');
  });
});
