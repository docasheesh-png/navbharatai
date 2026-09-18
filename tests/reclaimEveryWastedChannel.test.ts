/**
 * RECLAIM ALL (admin 2026-09-18). The Publish Capacity card kept recommending the one action it made
 * impractical: the capture carried 37 reclaimable channels, each with its own button.
 *
 * 🔒 THE RULES THIS PINS, because each one is a way a bulk DELETE could go wrong:
 *   • it asks first, naming the count;
 *   • it goes one at a time and STOPS at the first refusal, because the route refuses anything it
 *     cannot prove is waste and carrying on would mean deleting while the server says it cannot tell;
 *   • it reports how many really went, never the number it hoped for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../src/components/AdminDashboard.tsx'), 'utf8');
/** Comments stripped: a promise in a comment is not a promise in the UI. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const HANDLER = CODE.slice(CODE.indexOf('const reclaimAllChannels'), CODE.indexOf('const [handover'));

describe('the button exists and is wired', () => {
  it('a Reclaim all button calls the bulk handler', () => {
    expect(CODE).toContain('onClick={() => void reclaimAllChannels()}');
    expect(CODE).toContain('Reclaim all');
  });

  it('it shows real progress while it runs, not a spinner with no number', () => {
    expect(CODE).toContain('Reclaiming ${reclaimingAll.done}/${reclaimingAll.total}');
  });

  it('it is disabled while either kind of reclaim is in flight', () => {
    expect(CODE).toContain('disabled={!!reclaimingAll || !!reclaiming}');
  });
});

describe('🔒 a bulk delete has to be careful', () => {
  it('it asks first, and the question names the count', () => {
    expect(HANDLER).toContain('window.confirm(');
    expect(HANDLER).toContain('Reclaim ${targets.length} channel(s)?');
  });

  it('it only ever targets channels the SERVER marked reclaimable', () => {
    expect(HANDLER).toContain('.filter((c) => c.reclaimable)');
  });

  it('it stops at the first refusal instead of deleting past it', () => {
    expect(HANDLER).toContain('if (!d?.ok)');
    expect(HANDLER).toContain('break;');
  });

  it('⚠️ it is sequential — a parallel burst would race the route\'s own safety checks', () => {
    expect(HANDLER).toContain('for (const channelId of targets)');
    expect(HANDLER).not.toContain('Promise.all');
  });

  it('it reports what really happened, not what it attempted', () => {
    expect(HANDLER).toContain('Reclaimed ${done} of ${targets.length}, then stopped.');
  });

  it('it re-reads the list once at the end, and always', () => {
    expect(HANDLER).toContain('} finally {');
    expect(HANDLER).toContain('await fetchChannels();');
  });

  it('does nothing at all when there is nothing to reclaim', () => {
    expect(HANDLER).toContain('if (targets.length === 0) return;');
  });
});

describe('🔒 a build copy is described as a build copy', () => {
  it('a snapshot row no longer claims the app lost its chat and record', () => {
    expect(CODE).toContain("c.state === 'snapshot'");
    expect(CODE).toContain('A saved copy of a build, not a published app. It returns on the next build.');
  });

  it('the genuinely orphaned case keeps its own, different wording', () => {
    expect(CODE).toContain('Its chat and record are gone, but the app is still live');
  });

  it('the list header no longer calls every row waste', () => {
    expect(CODE).toContain('Reclaimable channels');
    expect(CODE).not.toContain('Wasted channels');
  });
});
