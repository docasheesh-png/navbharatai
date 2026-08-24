import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { isImportLine } from '../scripts/noUnusedImports.mjs';

/**
 * The one piece of judgement in the unused-import gate: deciding whether the line tsc pointed at is
 * part of an import statement. Getting it wrong in one direction lets unused imports through; in the
 * other it blocks CI on an unused local the gate is deliberately NOT policing yet.
 */
describe('isImportLine', () => {
  it('recognises a single-line import', () => {
    expect(isImportLine(["import { A } from './a';"], 1)).toBe(true);
  });

  it('recognises a binding on a continuation line of a multi-line import', () => {
    const lines = ['import {', '  Alpha,', '  Beta,', "} from './x';"];
    expect(isImportLine(lines, 2)).toBe(true);
    expect(isImportLine(lines, 3)).toBe(true);
  });

  it('does NOT treat ordinary code as an import', () => {
    const lines = ["import { A } from './a';", '', 'const unusedLocal = 1;'];
    expect(isImportLine(lines, 3)).toBe(false);
  });

  it('does not walk past real code into an earlier import', () => {
    // The failure this guards: an unused `useState` setter twenty lines below an import block being
    // reported as an unused import, which would block CI on the cleanup this gate defers.
    const lines = ["import { useState } from 'react';", 'function C() {', '  const x = 1;', '  const [a, setA] = useState(0);'];
    expect(isImportLine(lines, 4)).toBe(false);
  });

  it('handles a bare side-effect import line', () => {
    expect(isImportLine(["import './register';"], 1)).toBe(false);
  });
});

/**
 * The gate shipped in #2636 matching only TS6133, and TypeScript reports a declaration whose bindings
 * are ALL unused as TS6192 instead — with no name attached. So it printed "No unused imports" while
 * seven entire declarations sat unused in App.tsx and AgentProgress.tsx. That is the most expensive
 * shape of this bug, not the least: a whole unused declaration keeps a whole module on the load path.
 */
describe('the gate covers both error codes', () => {
  const src = readFileSync(join(resolve(__dirname, '..'), 'scripts/noUnusedImports.mjs'), 'utf8');

  it('matches TS6133 (one unused binding)', () => {
    expect(src).toContain('TS6133');
  });

  it('matches TS6192 (every binding in the declaration unused)', () => {
    expect(src).toContain('TS6192');
    expect(src).toContain('All imports in import declaration are unused');
  });

  it('reports a TS6192 hit WITHOUT calling isImportLine', () => {
    // TS6192 only ever refers to an import declaration, so there is no line shape to judge — and
    // routing it through isImportLine would reintroduce the miss, because tsc points at column 1 of
    // the `import` line itself rather than at a binding inside it.
    //
    // Sliced from the MATCHER, not from the first mention of the code: the header explains TS6192 in
    // prose well before the TS6133 loop, so slicing at `indexOf('TS6192')` spans the wrong loop —
    // which is exactly how this assertion failed the first time it was written.
    const loop = src.slice(src.indexOf('error TS6192: All imports'));
    expect(loop).toContain('offenders.push');
    expect(loop).not.toContain('isImportLine');
  });
});
