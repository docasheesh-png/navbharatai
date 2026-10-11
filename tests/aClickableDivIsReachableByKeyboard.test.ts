// A CLICKABLE <div> NEEDS TO BE REACHABLE BY KEYBOARD (2026-10-11, Q-600 sweep).
//
// The AI Code Review's warning says "add role=\"button\" + tabIndex={0} + onKeyDown", but it only checked the
// role: `hasTabIndex` was computed and never read, so `<div role="button" onClick>` with no tabIndex — which
// a keyboard can never focus — passed as accessible.
import { describe, it, expect } from 'vitest';
import { analyzeCode } from '../src/components/ide/AICodeReview';

const flagged = (code: string) => analyzeCode(code).some((i) => i.title.startsWith('Clickable <div>'));

describe('a clickable <div> must be focusable, not only labelled', () => {
  it('THE MISSED CASE: a role without tabIndex is still unreachable by keyboard', () => {
    expect(flagged('<div role="button" onClick={go}>Open</div>')).toBe(true);
  });
  it('no role → flagged, as before', () => {
    expect(flagged('<div onClick={go}>Open</div>')).toBe(true);
  });
  it('role and tabIndex → not flagged', () => {
    expect(flagged('<div role="button" tabIndex={0} onClick={go} onKeyDown={k}>Open</div>')).toBe(false);
  });
  it('no clickable div → not flagged', () => {
    expect(flagged('<button onClick={go}>Open</button>')).toBe(false);
  });
});
