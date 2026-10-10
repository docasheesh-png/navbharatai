import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * GT-14 — a build the watchdog ends never reaches the settle, so it was missing from the
 * failure ledger. Both exits call the once-helper. The store write itself happens once.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

function functionBody(src: string, header: string): string {
  const at = src.indexOf(header);
  if (at < 0) return '';
  const open = src.indexOf('{', at + header.length - 1);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return src.slice(at);
}

describe('a watchdog-ended build is still counted', () => {
  it('finalizeOnDeadline records the failure, and so does the settle', () => {
    const fin = functionBody(route, 'const finalizeOnDeadline = async () => {');
    expect(fin).toContain('recordFailureLedgerOnce(');
    const settleAt = route.indexOf('realCostRemainder: realCostRemainderForFailure');
    expect(settleAt).toBeGreaterThan(-1);
    expect(route.indexOf('recordFailureLedgerOnce(', settleAt)).toBeGreaterThan(settleAt);
  });

  it('there is exactly one direct store write, inside the once-helper', () => {
    const calls = route.match(/failureLedgerStore\.record\(/g) || [];
    expect(calls).toHaveLength(1);
    expect(route).toContain('void failureLedgerStore.record(entry)');
    expect(route).not.toContain('await failureLedgerStore.record(');
  });

  it('both exits share one cost expression', () => {
    const hits = route.match(/realProviderCostUsd\(/g) || [];
    expect(hits).toHaveLength(1);
    expect(route).toContain('realProviderCostUsd(i.entries, i.remainder) + Math.max(0, i.sandboxUsd || 0)');
  });
});
