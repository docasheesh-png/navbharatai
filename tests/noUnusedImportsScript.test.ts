import { describe, it, expect } from 'vitest';
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
