// failedbr #1276, #1277, #1263 (2026-11-20): one report said "(discount 0%, delivery: working-app)" and, one line later,
// "Build discount 10% applied". Both were true — the first is the discount for STOPPING (none: the app worked), the second
// the platform's build discount — but the same word made them read as a contradiction. Each now says which it is.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('the stop discount and the build discount are named apart', () => {
  it('every CANCELLED_BUILD_CHARGED line says "stop discount", never a bare "discount"', () => {
    const lines = ROUTE.split('\n').filter((l) => /cancelBill\.discountPct|charged\.discountPct/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(l, l.trim()).toMatch(/\(stop discount \$\{/);
    expect(ROUTE).not.toMatch(/\(discount \$\{/);
  });
});
