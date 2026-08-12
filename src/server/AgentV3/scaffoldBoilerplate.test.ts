import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SCAFFOLD_BOILERPLATE, isScaffoldBoilerplate, canonicalScaffold,
  scaffoldFilesInTscErrors, tscFailureIsOnlyScaffold, scaffoldRestores,
} from './scaffoldBoilerplate';

/**
 * THE RECURRING ERROR, from three real reports (2026-08-12):
 *
 *   src/ErrorBoundary.tsx(10,10): error TS2339: Property 'state' does not exist on type 'ErrorBoundary'.
 *
 * The scaffold ships a CORRECT class-component error boundary. A weak coder that touches it breaks its
 * typing and then cannot fix it — a React error boundary must be a class, which the model does not know.
 * Five `npx tsc` passes were burned on one boilerplate file. The fix restores our version deterministically
 * instead of asking the model to win a fight it keeps losing.
 */

const REAL_ERROR = [
  'src/ErrorBoundary.tsx(10,10): error TS2339: Property \'state\' does not exist on type \'ErrorBoundary\'.',
  'src/ErrorBoundary.tsx(22,14): error TS2339: Property \'setState\' does not exist on type \'ErrorBoundary\'.',
  'src/ErrorBoundary.tsx(26,64): error TS2339: Property \'props\' does not exist on type \'ErrorBoundary\'.',
].join('\n');

describe('the canonical boilerplate', () => {
  it('the scaffold\'s error boundary is the one we restore — same source, one source of truth', () => {
    // The canonical content is imported from the scaffold generator, never a second hand-kept copy that
    // could drift from what actually ships.
    const scaffold = readFileSync(
      join(__dirname, 'sandbox/AppMakerLab/generator/templates/ViteReactProviderContents.ts'), 'utf8',
    );
    expect(scaffold).toContain('export const errorBoundaryTsx');
    expect(canonicalScaffold('src/ErrorBoundary.tsx')).toContain('extends React.Component<Props, State>');
    expect(canonicalScaffold('src/ErrorBoundary.tsx')).toContain('state: State = { error: null };');
  });

  it('only pure boilerplate is protected — never App.tsx or anything with the user\'s features', () => {
    // Restoring a canonical version asserts "the model has no legitimate reason to change this". That is
    // true of an error boundary and almost nothing else.
    expect(isScaffoldBoilerplate('src/ErrorBoundary.tsx')).toBe(true);
    expect(isScaffoldBoilerplate('src/App.tsx')).toBe(false);
    expect(isScaffoldBoilerplate('src/main.tsx')).toBe(false);
    expect(canonicalScaffold('src/App.tsx')).toBeNull();
  });
});

describe('reading which boilerplate a tsc failure blames', () => {
  it('finds the error boundary in the real error output', () => {
    expect(scaffoldFilesInTscErrors(REAL_ERROR)).toEqual(['src/ErrorBoundary.tsx']);
  });

  it('tolerates a leading ./', () => {
    expect(scaffoldFilesInTscErrors('./src/ErrorBoundary.tsx(9,10): error TS2339: ...')).toEqual(['src/ErrorBoundary.tsx']);
  });

  it('a failure ONLY in the boilerplate is detected — a deterministic restore will very likely clear it', () => {
    expect(tscFailureIsOnlyScaffold(REAL_ERROR)).toBe(true);
  });

  it('a failure that ALSO blames the user\'s own files is NOT boilerplate-only', () => {
    const mixed = REAL_ERROR + '\nsrc/game.ts(184,3): error TS2345: Argument of type ...';
    expect(tscFailureIsOnlyScaffold(mixed)).toBe(false);
    // But the boilerplate is still found, so it can still be restored before the model handles the rest.
    expect(scaffoldFilesInTscErrors(mixed)).toEqual(['src/ErrorBoundary.tsx']);
  });

  it('clean output blames nothing', () => {
    expect(scaffoldFilesInTscErrors('')).toEqual([]);
    expect(tscFailureIsOnlyScaffold('no errors here')).toBe(false);
  });

  it('a non-boilerplate-only failure never claims boilerplate-only', () => {
    expect(tscFailureIsOnlyScaffold('src/game.ts(1,1): error TS2304: Cannot find name x')).toBe(false);
  });
});

describe('deciding the restores', () => {
  it('restores when the on-disk file has drifted from canonical', () => {
    const broken = 'class ErrorBoundary extends Component { state = {}; }'; // a model rewrite
    const restores = scaffoldRestores({ 'src/ErrorBoundary.tsx': broken }, REAL_ERROR);
    expect(Object.keys(restores)).toEqual(['src/ErrorBoundary.tsx']);
    expect(restores['src/ErrorBoundary.tsx']).toBe(SCAFFOLD_BOILERPLATE['src/ErrorBoundary.tsx']);
  });

  it('does NOT restore a file that is ALREADY canonical — tsc is blaming a correct file, cause is elsewhere', () => {
    // e.g. react types momentarily unresolvable. Rewriting an identical file would be a pointless write
    // and would not help; the real fix is elsewhere.
    const current = { 'src/ErrorBoundary.tsx': SCAFFOLD_BOILERPLATE['src/ErrorBoundary.tsx'] };
    expect(scaffoldRestores(current, REAL_ERROR)).toEqual({});
  });

  it('restores a file that is MISSING entirely', () => {
    expect(scaffoldRestores({}, REAL_ERROR)['src/ErrorBoundary.tsx']).toBeTruthy();
  });

  it('restores nothing when the failure is not about boilerplate', () => {
    expect(scaffoldRestores({ 'src/ErrorBoundary.tsx': 'broken' }, 'src/game.ts(1,1): error TS2304: x')).toEqual({});
  });
});

describe('it is wired into the tsc gate — deterministic restore BEFORE the model', () => {
  const routes = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('the restore runs before the model repair pass', () => {
    const restoreAt = routes.indexOf('scaffoldFilesInTscErrors(check.errors)');
    const modelAt = routes.indexOf('Type-checking the finished build — found type errors, fixing them');
    expect(restoreAt).toBeGreaterThan(-1);
    expect(modelAt).toBeGreaterThan(restoreAt); // deterministic first, model second
  });

  it('it re-checks tsc after restoring, so a cleared failure skips the model entirely', () => {
    expect(routes).toContain('SCAFFOLD_RESTORED');
    const at = routes.indexOf('SCAFFOLD_RESTORED');
    expect(routes.slice(at, at + 400)).toContain('check = await runTsc()');
  });

  it('has a kill switch', () => {
    expect(routes).toContain("process.env.AGENTV3_SCAFFOLD_RESTORE !== 'off'");
  });
});
