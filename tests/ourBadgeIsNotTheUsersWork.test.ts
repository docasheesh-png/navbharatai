// failedbr #1276 (2026-11-20): the model made no edit, yet CHANGE_RECORDED said "1 file(s)". update_preview writes OUR badge
// into index.html inside a model tool call, so the seeded index.html no longer equalled the seed — and the stop bill reads
// the same count: a template + badge, nothing rendered, would have been charged as a file of the user's own.
import { describe, expect, it } from 'vitest';
import { injectAppSignature, sameAsSeeded } from '../src/server/AgentV3/appSignature';
import { preseededUnchangedCount, decideCancelledBuildBill } from '../src/server/AgentV3/cancelledBuildBilling';
import { reviewChangedPaths } from '../src/server/AgentV3/ReviewerAgent';

const SEED = '<!doctype html>\n<html>\n<head><title>Quran Reader</title></head>\n<body>\n<div id="root"></div>\n<script type="module" src="/src/main.tsx"></script>\n</body>\n</html>\n';
const SIGNED = injectAppSignature(SEED);

describe('our badge is not the user\'s work (failedbr #1276)', () => {
  it('a seeded file differing only by the badge is still the seed', () => {
    expect(SIGNED).not.toBe(SEED);
    expect(sameAsSeeded(SEED, SIGNED)).toBe(true);
    expect(sameAsSeeded(SEED, SIGNED.replace('Quran Reader', 'My Reader'))).toBe(false);
    expect(sameAsSeeded(SEED, SEED.replace('root', 'app'))).toBe(false);
  });
  it('the change record counts no file, and the stop bill sees only the template', () => {
    const preseeded = new Map([['index.html', SEED], ['src/App.tsx', 'export default 1;']]);
    const written = new Map([['index.html', SIGNED], ['src/App.tsx', 'export default 1;']]);
    expect(reviewChangedPaths(written, new Set(), preseeded)).toEqual([]);
    expect(preseededUnchangedCount(preseeded, written)).toBe(2);
    const bill = decideCancelledBuildBill({ abortCause: 'user-stop', decidedBilledUsd: 0.15, filesWritten: written.size, preseededUnchanged: preseededUnchangedCount(preseeded, written), appRendered: false } as never);
    expect(bill.delivery).toBe('seed-only');
    expect(bill.billedUsd).toBe(0);
  });
});
