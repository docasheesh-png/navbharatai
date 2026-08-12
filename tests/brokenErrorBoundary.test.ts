import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { looksLikeBrokenErrorBoundary, analyzeErrorBoundary, errorBoundarySummary } from '../src/server/AgentV3/ErrorBoundaryAnalysis';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. Three warnings, one file, one cause — and none of the
 * three said what was actually wrong.
 *
 *     [warning] 1 component(s) created but never used: src/ErrorBoundary.tsx (ErrorBoundary)
 *     [warning] React app has no error boundary
 *     tsc:      Property 'state'    does not exist on type 'ErrorBoundary'.
 *     tsc:      Property 'props'    does not exist on type 'ErrorBoundary'.
 *     tsc:      Property 'setState' does not exist on type 'ErrorBoundary'.
 *
 * What was written is not an error boundary. It is a class named ErrorBoundary that reaches for
 * `this.state` / `this.props` / `this.setState` without extending React.Component — which is exactly why
 * TypeScript says those members do not exist — and it carries neither `componentDidCatch` nor
 * `getDerivedStateFromError`, which is why the boundary check saw nothing and reported the app has none.
 *
 * THE REASON THIS NEEDS ITS OWN FINDING is what the other message causes. "React app has no error
 * boundary" invites exactly one response — add an error boundary — and this repo has already paid for
 * that twice: the duplicate-ErrorBoundary autopsies of 2026-08-02 needed a dedupe pass, and then a
 * SECOND pre-verdict dedupe pass. Telling a repair pass to ADD one while a broken one sits in the
 * project is how the duplicate gets created in the first place.
 */

const BROKEN = `
import React from 'react';
class ErrorBoundary {
  state = { hasError: false };
  render() { return this.state.hasError ? <p>error</p> : this.props.children; }
}
export default ErrorBoundary;
`;

const REAL = `
import React from 'react';
export class ErrorBoundary extends React.Component {
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error(err, info); }
  render() { return this.state.hasError ? <p>error</p> : this.props.children; }
}
`;

describe('the file that was named for a job it does not do', () => {
  it('flags the report\'s file', () => {
    expect(looksLikeBrokenErrorBoundary('src/ErrorBoundary.tsx', BROKEN)).toBe(true);
  });

  it('a REAL boundary is never flagged', () => {
    expect(looksLikeBrokenErrorBoundary('src/ErrorBoundary.tsx', REAL)).toBe(false);
  });

  it('either lifecycle hook alone is enough to count as real', () => {
    // React routes render errors through these two and nothing else; one of them is the definition.
    expect(looksLikeBrokenErrorBoundary('src/EB.tsx', 'class ErrorBoundary { componentDidCatch(){} }')).toBe(false);
    expect(looksLikeBrokenErrorBoundary('src/EB.tsx', 'class ErrorBoundary { static getDerivedStateFromError(){} }')).toBe(false);
  });

  it('the react-error-boundary library counts too', () => {
    expect(looksLikeBrokenErrorBoundary('src/ErrorBoundary.tsx', "import { ErrorBoundary } from 'react-error-boundary';\nexport const ErrorBoundary2 = ErrorBoundary;")).toBe(false);
  });

  it('a file that merely RENDERS someone else\'s boundary is never flagged', () => {
    /**
     * THE PRECISION LINE. App.tsx wrapping the tree in `<ErrorBoundary>` declares nothing of its own —
     * flagging it would tell a repair pass to "fix" the file that was already doing the right thing.
     */
    expect(looksLikeBrokenErrorBoundary('src/App.tsx', "import ErrorBoundary from './ErrorBoundary';\nexport default () => <ErrorBoundary><Home/></ErrorBoundary>;")).toBe(false);
    expect(looksLikeBrokenErrorBoundary('src/main.tsx', "import EB from './ErrorBoundary';\nroot.render(<EB><App/></EB>);")).toBe(false);
  });

  it('catches it by DECLARATION even when the filename says nothing', () => {
    expect(looksLikeBrokenErrorBoundary('src/components/Guards.tsx', 'export class AppErrorBoundary { render(){ return this.props.children; } }')).toBe(true);
    expect(looksLikeBrokenErrorBoundary('src/x.tsx', 'export function ErrorBoundaryShell(){ return null; }')).toBe(true);
  });

  it('an empty or absent file is not a finding', () => {
    for (const c of ['', '   ', null as any, undefined as any]) {
      expect(looksLikeBrokenErrorBoundary('src/ErrorBoundary.tsx', c)).toBe(false);
    }
  });
});

describe('what the engine is told to DO about it', () => {
  it('says fix that file, and says NOT to add another', () => {
    const r = analyzeErrorBoundary(7, false, ['src/ErrorBoundary.tsx']);
    const msg = r.findings[0].message;
    expect(msg).toContain('src/ErrorBoundary.tsx');
    expect(msg).toMatch(/does not implement one/);
    expect(msg).toMatch(/FIX THAT FILE/);
    expect(msg).toMatch(/Do NOT add a second error boundary/);
  });

  it('names the two hooks that are missing, so the fix is unambiguous', () => {
    const msg = analyzeErrorBoundary(7, false, ['src/ErrorBoundary.tsx']).findings[0].message;
    expect(msg).toMatch(/componentDidCatch/);
    expect(msg).toMatch(/getDerivedStateFromError/);
    expect(msg).toMatch(/extending React\.Component/); // the TS2339 cause, named
  });

  it('a genuinely ABSENT boundary keeps the old "add one" message unchanged', () => {
    const msg = analyzeErrorBoundary(7, false, []).findings[0].message;
    expect(msg).toMatch(/^No error boundary in this React app/);
    expect(msg).not.toMatch(/Do NOT add/);
  });

  it('an app WITH a working boundary still reports nothing at all', () => {
    const r = analyzeErrorBoundary(7, true, []);
    expect(r.findings).toEqual([]);
    expect(errorBoundarySummary(r)).toMatch(/✓ the app has an error boundary/);
  });

  it('a tiny app is still not assessed — the old precision rule holds', () => {
    expect(analyzeErrorBoundary(1, false, ['src/ErrorBoundary.tsx']).assessed).toBe(false);
    expect(analyzeErrorBoundary(1, false, ['src/ErrorBoundary.tsx']).findings).toEqual([]);
  });

  it('the summary distinguishes "broken" from "missing"', () => {
    expect(errorBoundarySummary(analyzeErrorBoundary(7, false, ['src/ErrorBoundary.tsx']))).toMatch(/present but not working/);
    expect(errorBoundarySummary(analyzeErrorBoundary(7, false, []))).toMatch(/Error boundary — missing:/);
  });

  it('duplicate paths are collapsed, and junk is dropped', () => {
    const r = analyzeErrorBoundary(7, false, ['a.tsx', 'a.tsx', '', '  ', null as any]);
    expect(r.brokenBoundaries).toEqual(['a.tsx']);
  });

  it('omitting the argument entirely behaves exactly as before', () => {
    expect(analyzeErrorBoundary(7, false).findings[0].message).toMatch(/^No error boundary in this React app/);
    expect(analyzeErrorBoundary(7, false).brokenBoundaries).toEqual([]);
  });
});

describe('WIRING — readiness scans for it and reports the right instruction', () => {
  const d = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

  it('the scan runs over the same sources the boundary check uses', () => {
    expect(d).toContain('this.collectBrokenErrorBoundaries(snap.sources)');
    expect(d).toContain('looksLikeBrokenErrorBoundary(path, content)');
  });

  it('the readiness label tells the repair pass to fix, not to add', () => {
    expect(d).toContain('fix that file, do NOT add another');
    expect(d).toContain("'React app has no error boundary'"); // the absent case keeps its old label
  });

  it('it stays a MEDIUM finding — a missing boundary must not block a working app', () => {
    const at = d.indexOf('is named like an error boundary but implements none');
    expect(d.slice(at - 300, at)).toContain("severity: 'medium'");
  });
});
