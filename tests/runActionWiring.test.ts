/**
 * The wiring, pinned — because dropping any of it FAILS NOTHING.
 *
 * Every fix from build 7bc15e40 is a fact passed into a decision. Remove the argument and the code
 * still compiles (each has a safe default), the build still runs, and the platform silently goes
 * back to telling a user their working app produced nothing and asking them for money.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
/** Strip comments: a doc block that MENTIONS a call must not satisfy an assertion about the call. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the empty-build verdict', () => {
  it('is computed ONCE, so the failure message and the upsell cannot disagree', () => {
    expect((code.match(/emptyTurnWasLegitimate\(/g) ?? []).length).toBe(1);
  });

  it('reaches emptyBuildFailureSummary — without it, zero files is a failure again', () => {
    expect(code).toMatch(/emptyBuildFailureSummary\(expectsArtifacts,\s*writtenFiles\.size,\s*sandboxUnavailable,\s*emptyWasLegitimate\)/);
  });

  it('carries the EVIDENCE half — a live preview, not just the word "run"', () => {
    expect(code).toMatch(/appWasRunAndShown:\s*previewVerifiedRendered\s*\|\|\s*Boolean\(lastPreviewUrl\)/);
  });

  it('suppresses the upsell, and records that it did', () => {
    expect(code).toMatch(/if \(!refused && !emptyWasLegitimate\)/);
    expect(code).toMatch(/if \(refused \|\| degraded \|\| emptyWasLegitimate\)/);
  });
});

describe('the typecheck claim', () => {
  it('is read from the release gate’s own evidence, never assumed', () => {
    // gateEvidence.typecheck starts at 'not-run' and is only moved by a check that actually ran, so
    // this cannot report a typecheck that never happened.
    expect(code).toMatch(/typecheckRan:\s*gateEvidence\.typecheck\s*!==\s*'not-run'/);
  });
});
