// failedbr #1820 (2026-11-20): three fast-lane repair files were refused with `Unexpected "<<"` / `Unexpected ">>>"`
// at column 0 and a hint about a DUPLICATE declaration. A line of seven '<' / '>' is a conflict or SEARCH/REPLACE
// marker; a `<<<FILE` / `<<<ENDFILE` line is the lane's own wrapper. The hint now names which.
import { describe, expect, it } from 'vitest';
import { firstSyntaxError, markerLineIn, parseGuardDecision } from '../src/server/AgentV3/SyntaxCheck';

const CONFLICTED = [
  "import React from 'react';", '', 'export default function DashboardPage() {', '  return (', '    <div>', '      <h1>Dashboard</h1>',
  '    </div>', '  );', '<<<<<<< SEARCH', '}', '=======', '}', '>>>>>>> REPLACE', '',
].join('\n');
const WRAPPED = ["export const a = 1;", '<<<ENDFILE>>', ''].join('\n');

describe('a marker in a whole-file write is named, not called a duplicate (failedbr #1820)', () => {
  it('the conflict shape #1820 reported (`<<` at column 0 of line 9) gets the marker hint', async () => {
    const err = await firstSyntaxError('src/pages/DashboardPage.tsx', CONFLICTED);
    expect(err?.line).toBe(9);
    const msg = parseGuardDecision('src/pages/DashboardPage.tsx', null, err, true, CONFLICTED)!;
    expect(msg).toMatch(/Line 9 is a merge-conflict or diff marker \("<<<<<<< SEARCH"\)/);
    expect(msg).not.toMatch(/DUPLICATE declaration/);
  });

  it('a wrapper line left inside the content is named as the wrapper', async () => {
    const err = await firstSyntaxError('src/a.ts', WRAPPED);
    const msg = parseGuardDecision('src/a.ts', null, err, true, WRAPPED)!;
    expect(msg).toMatch(/file-wrapper line \("<<<ENDFILE>>"\)/);
  });

  it('without markers the old hints are unchanged', async () => {
    const dup = 'const a = 1;\nconst a = 2;\n';
    const err = await firstSyntaxError('src/b.ts', dup);
    expect(parseGuardDecision('src/b.ts', null, err, true, dup)).toMatch(/DUPLICATE declaration/);
    expect(markerLineIn("const shift = a << 2;\nconst z = b >>> 1;\n")).toBeNull();
  });
});

describe('the write door hands the content to the guard', () => {
  it('ToolDispatcher passes the new content, so the marker can be named', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toContain('parseGuardDecision(path, errOld, errNew, true, newContent)');
  });
});
