import { describe, it, expect } from 'vitest';
import {
  joinContinuation,
  resumedFilePath,
  continuationRestartsFile,
  continuationPrompt,
} from '../src/server/AgentV3/FastLaneContinuation';
import { parseFileBlocks } from '../src/server/AgentV3/OneShotBuilder';

// Build bb688add (2026-09-20) — a one-page Hindi invitation card. `FASTLANE_CONTINUED` fired and the
// emitted `src/components/Invitation.css` began `-size: 0.9rem;`, the tail of `font-size`, with every
// rule above it gone.
//
// THE MECHANISM, reproduced exactly below. The continuation prompt asks the model to resume "in the
// same <<<FILE path>>> … <<<ENDFILE>>> format", so a model cut off mid-file re-OPENS that block and
// emits only the REMAINDER inside it. parseFileBlocks de-dupes by path LAST-wins, so the remainder
// REPLACED the finished head of the file rather than extending it.
//
// `joinContinuation`'s docblock knew exactly two ways a model resumes — mid-content with no header
// (fuse) and the whole file again under a header (last-wins). This is the third, and it is the one
// that destroys work already produced and already paid for. A `.tsx` in that state is caught by the
// syntax gate; a `.css`, `.json` or `.html` is not, so it ships.

const HEAD = [
  '<<<FILE src/App.tsx>>>',
  'export default function App() { return <div>ok</div>; }',
  '<<<ENDFILE>>>',
].join('\n');

/** The first call: App.tsx complete, Invitation.css cut off in the middle of `font-size`. */
const CUT_MID_TOKEN = [
  HEAD,
  '<<<FILE src/components/Invitation.css>>>',
  '.invite { color: #b8860b; }',
  '.invite .names { font-weight: 700; }',
  '.invite .date { font',
].join('\n');

/** The continuation the real model sent: the same header again, then only the remainder. */
const REMAINDER_UNDER_A_REPEATED_HEADER = [
  '<<<FILE src/components/Invitation.css>>>',
  '-size: 0.9rem; }',
  '.invite .venue { letter-spacing: 1px; }',
  '<<<ENDFILE>>>',
].join('\n');

function cssOf(text: string): string {
  const f = parseFileBlocks(text).find((x) => x.path === 'src/components/Invitation.css');
  return f?.content ?? '';
}

describe('the real failure from build bb688add', () => {
  it('does not leave the resumed file starting with the tail of a split token', () => {
    const css = cssOf(joinContinuation(CUT_MID_TOKEN, REMAINDER_UNDER_A_REPEATED_HEADER));
    // The literal defect: the file's first line was `-size: 0.9rem;`.
    expect(css.startsWith('-size:')).toBe(false);
  });

  it('keeps every rule the first call had already written', () => {
    const css = cssOf(joinContinuation(CUT_MID_TOKEN, REMAINDER_UNDER_A_REPEATED_HEADER));
    expect(css).toContain('.invite { color: #b8860b; }');
    expect(css).toContain('.invite .names { font-weight: 700; }');
  });

  it('welds the split token back together at the exact cut character', () => {
    const css = cssOf(joinContinuation(CUT_MID_TOKEN, REMAINDER_UNDER_A_REPEATED_HEADER));
    expect(css).toContain('font-size: 0.9rem;');
    // No newline, no space, no duplicated header text injected at the seam.
    expect(css).not.toContain('font\n-size');
    expect(css).not.toContain('<<<FILE');
  });

  it('keeps what the continuation added after the seam', () => {
    const css = cssOf(joinContinuation(CUT_MID_TOKEN, REMAINDER_UNDER_A_REPEATED_HEADER));
    expect(css).toContain('.invite .venue { letter-spacing: 1px; }');
  });

  it('leaves the file that was already finished untouched', () => {
    const files = parseFileBlocks(joinContinuation(CUT_MID_TOKEN, REMAINDER_UNDER_A_REPEATED_HEADER));
    const app = files.find((f) => f.path === 'src/App.tsx');
    expect(app?.content).toBe('export default function App() { return <div>ok</div>; }');
  });

  it('names the file it rejoined, so the report can say a weld happened', () => {
    expect(resumedFilePath(CUT_MID_TOKEN, REMAINDER_UNDER_A_REPEATED_HEADER))
      .toBe('src/components/Invitation.css');
  });
});

describe('the two ways of resuming that already worked stay exactly as they were', () => {
  it('a continuation with NO header still fuses into the open block', () => {
    const cont = ['-size: 0.9rem; }', '.invite .venue { letter-spacing: 1px; }', '<<<ENDFILE>>>'].join('\n');
    const css = cssOf(joinContinuation(CUT_MID_TOKEN, cont));
    expect(css).toContain('.invite { color: #b8860b; }');
    expect(css).toContain('font-size: 0.9rem;');
    expect(resumedFilePath(CUT_MID_TOKEN, cont)).toBeNull();
  });

  it('a continuation that RESTARTS the whole file still replaces the partial, not doubles it', () => {
    const restart = [
      '<<<FILE src/components/Invitation.css>>>',
      '.invite { color: #b8860b; }',
      '.invite .names { font-weight: 700; }',
      '.invite .date { font-size: 0.9rem; }',
      '<<<ENDFILE>>>',
    ].join('\n');
    const css = cssOf(joinContinuation(CUT_MID_TOKEN, restart));
    expect(resumedFilePath(CUT_MID_TOKEN, restart)).toBeNull();
    // Exactly one copy of the opening rule — a fused restart would have produced two.
    expect(css.split('.invite { color: #b8860b; }').length - 1).toBe(1);
    expect(css).toContain('font-size: 0.9rem;');
  });

  it('a restart is still recognised when the ceiling fell INSIDE the first line', () => {
    const cut = [HEAD, '<<<FILE src/theme.css>>>', ':root { --brand-gold: #b8'].join('\n');
    const restart = ['<<<FILE src/theme.css>>>', ':root { --brand-gold: #b8860b; }', '<<<ENDFILE>>>'].join('\n');
    expect(resumedFilePath(cut, restart)).toBeNull();
    const out = parseFileBlocks(joinContinuation(cut, restart)).find((f) => f.path === 'src/theme.css');
    expect(out?.content).toBe(':root { --brand-gold: #b8860b; }');
  });
});

describe('the weld is refused wherever we cannot be sure', () => {
  it('a continuation that opens a DIFFERENT file is never rewritten', () => {
    const other = ['<<<FILE src/other.css>>>', '.x { color: red; }', '<<<ENDFILE>>>'].join('\n');
    expect(resumedFilePath(CUT_MID_TOKEN, other)).toBeNull();
    expect(joinContinuation(CUT_MID_TOKEN, other)).toContain('<<<FILE src/other.css>>>');
  });

  it('a previous response that ended CLEANLY has nothing to resume', () => {
    const clean = [HEAD, '<<<FILE src/a.css>>>', '.a { color: red; }', '<<<ENDFILE>>>'].join('\n');
    const cont = ['<<<FILE src/a.css>>>', '.a { color: blue; }', '<<<ENDFILE>>>'].join('\n');
    expect(resumedFilePath(clean, cont)).toBeNull();
  });

  it('a continuation that opens with PROSE is left alone', () => {
    const prose = ['Sure, continuing now:', '<<<FILE src/components/Invitation.css>>>', '-size: 0.9rem; }', '<<<ENDFILE>>>'].join('\n');
    expect(resumedFilePath(CUT_MID_TOKEN, prose)).toBeNull();
  });

  it('an empty partial body is treated as a restart — there is nothing to preserve', () => {
    const cut = [HEAD, '<<<FILE src/a.css>>>', ''].join('\n');
    const cont = ['<<<FILE src/a.css>>>', '.a { color: red; }', '<<<ENDFILE>>>'].join('\n');
    expect(resumedFilePath(cut, cont)).toBeNull();
  });

  it('a partial body too short to compare is treated as a restart', () => {
    expect(continuationRestartsFile('.a {', 'anything at all here')).toBe(true);
    expect(continuationRestartsFile('', 'anything at all here')).toBe(true);
  });
});

describe('continuationRestartsFile reads the file, not the formatting', () => {
  it('ignores leading blank lines and indentation', () => {
    expect(continuationRestartsFile('\n\n  import React from "react";\nconst a = 1;', '  import React from "react";\nconst a = 1;\nconst b = 2;')).toBe(true);
  });

  it('a remainder from deep inside the file is not a restart', () => {
    expect(continuationRestartsFile('import React from "react";\nexport function Card() {\n  return <div>ha', 'lf</div>;\n}')).toBe(false);
  });
});

describe('joining itself is unchanged where it was already right', () => {
  it('an empty continuation returns what we had', () => {
    expect(joinContinuation('abc', '')).toBe('abc');
  });

  it('an empty previous returns the continuation', () => {
    expect(joinContinuation('', 'abc')).toBe('abc');
  });

  it('a header that resumes at a line start is not welded onto the previous line', () => {
    const joined = joinContinuation('...<<<ENDFILE>>>', '<<<FILE src/a.css>>>\n.a{}\n<<<ENDFILE>>>');
    expect(joined).toContain('<<<ENDFILE>>>\n<<<FILE src/a.css>>>');
  });
});

describe('the upstream half: the prompt no longer invites the repeated header', () => {
  it('names the file that was cut off and forbids re-opening it', () => {
    const p = continuationPrompt(CUT_MID_TOKEN);
    expect(p).toContain('src/components/Invitation.css');
    expect(p).toContain('Do NOT write its <<<FILE src/components/Invitation.css>>>');
  });

  it('still forbids the repeated header when no file was left open', () => {
    const p = continuationPrompt([HEAD].join('\n'));
    expect(p).toContain('WITHOUT repeating its <<<FILE …>>> header');
  });
});
