import { describe, it, expect } from 'vitest';
import { knownDepVersion, pinKnownDepsInInstallCommand, TYPINGS_TRACK_RUNTIME, WELL_KNOWN_DEPS } from '../src/server/AgentV3/DependencyAutoFix';
import { detectTypesMajorMismatch } from '../src/server/AgentV3/DependencyAnalysis';

/**
 * A PINNED RUNTIME KEEPS ITS TYPINGS (autopsy 398db9f3 — PAWTRACE, 2026-10-14).
 *
 * `express` is pinned to ^4; `npm install -D @types/express` took the latest (5). Express 4 under v5 typings
 * made `req.params.x` a `string | string[]`, failed three typechecks (TS2345) and left a "types-mismatch"
 * warning on the finished app. The CLASS: a runtime pinned in the allowlist whose typings are not.
 */
describe('typings follow the pinned runtime', () => {
  it('the real command from the report is rewritten', () => {
    const cmd = 'npm install -D @types/express @types/bcryptjs @types/jsonwebtoken';
    expect(pinKnownDepsInInstallCommand(cmd)).toBe('npm install -D @types/express@^4 @types/bcryptjs@^2 @types/jsonwebtoken@^9');
  });

  it('every listed runtime is pinned, so its typings have a major to follow', () => {
    for (const r of TYPINGS_TRACK_RUNTIME) {
      expect(Object.prototype.hasOwnProperty.call(WELL_KNOWN_DEPS, r), r).toBe(true);
      expect(knownDepVersion(`@types/${r}`), r).toBe(WELL_KNOWN_DEPS[r].replace(/^(\^\d+).*$/, '$1'));
    }
  });

  it('an explicit version, an unlisted package, and a runtime that ships its own types pass through', () => {
    expect(pinKnownDepsInInstallCommand('npm install -D @types/express@5')).toBe('npm install -D @types/express@5');
    expect(knownDepVersion('@types/node')).toBe('');
    expect(knownDepVersion('@types/react')).toBe('');
    expect(knownDepVersion('@types/axios')).toBe('');
  });

  it('the pinned pair no longer trips the types-mismatch finding', () => {
    const pkg = JSON.stringify({ dependencies: { express: '^4' }, devDependencies: { '@types/express': knownDepVersion('@types/express') } });
    expect(detectTypesMajorMismatch(pkg)).toEqual([]);
    const drifted = JSON.stringify({ dependencies: { express: '^4' }, devDependencies: { '@types/express': '^5' } });
    expect(detectTypesMajorMismatch(drifted)).toHaveLength(1);
  });
});
