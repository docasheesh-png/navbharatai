// AUTOPSY 6bae5835 (2026-09-27) — TIME_TO_FIRST_RENDER said 323 s; APP_RENDERED said 303 s. The clock was
// written only by the in-build SNAPSHOT path, so a render proved by the render rescue, or by an in-build
// attempt whose snapshot was refused as raced, never stopped it. `tsc` and `vitest` cannot see which
// path writes a measurement, so this guard reads the source. (First-writer-wins is locked in
// whoWroteAfterTheAppWasGreen.test.ts.)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('🔴 the first-render clock stops at the first real-browser proof', () => {
  it('the render ledger (markAppRendered) writes it, for a real browser only', () => {
    const start = route.indexOf('const markAppRendered = (');
    const body = route.slice(start, route.indexOf('\n      };', start));
    expect(body).toMatch(/if \(source === 'browser'\) \{ try \{ buildDiag\.recordTimeToFirstRender\(Date\.now\(\) - buildStartedAt\)/);
  });
  it('a raced in-build render counts, a starter page never does', () => {
    expect(route).toContain("outcome.kind === 'proven' || (outcome.kind === 'raced' && !starterIsWhatRendered(starterEntryIn(files), shot.html))");
  });
});
