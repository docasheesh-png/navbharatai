import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { channelCeilingVerdict, type ClassifiedChannel } from '../server/AgentV3/channelInventory';

const dash = readFileSync(resolve(__dirname, 'AdminDashboard.tsx'), 'utf8');
const tile = (() => {
  const at = dash.indexOf("statCard(\n                  'Published Apps'");
  return dash.slice(at, at + 1400);
})();

const chan = (reclaimable: boolean): ClassifiedChannel => ({
  channelId: 'v3-x', url: '', updateTime: null, state: reclaimable ? 'unknown' : 'live',
  workspaceId: reclaimable ? null : 'ws', reclaimable,
});

describe('Published Apps tile — the ceiling, readable at a glance', () => {
  it('exists on the Overview page', () => {
    // The full Publish Capacity card has carried this number since 2026-08-21, but under four rows of
    // tiles — and the admin did not know it was there. A ceiling that stops publishing for EVERY user
    // at once has to sit among the other counts.
    expect(tile).toContain("'Published Apps'");
  });

  it('🔒 shows "—" for an unreadable list, NEVER a count of zero', () => {
    // Reporting a failed read as "no apps published" is the exact dishonesty the endpoint itself
    // refuses ("the ceiling is UNKNOWN, not clear"). The tile must hold the same line.
    expect(tile).toContain("channelsError || !channels ? '—'");
    expect(tile).toContain('not a count of zero');
  });

  it('🔒 reads the SAME verdict the capacity card reads, so the two cannot disagree', () => {
    // Two independently-derived numbers on one screen is how an admin stops trusting either.
    expect(tile).toContain('channels.verdict.used');
    expect(tile).toContain('channels.verdict.cap');
    expect(tile).not.toMatch(/channels\.channels\.length/);
  });

  it('carries the same colour thresholds as the card below it', () => {
    expect(tile).toContain("channels.verdict.level === 'critical' ? 'bg-red-500'");
    expect(tile).toContain("channels.verdict.level === 'warn' ? 'bg-amber-500'");
  });
});

describe('the verdict behind the tile', () => {
  it('counts used against the cap and reports what is left', () => {
    const v = channelCeilingVerdict([chan(false), chan(false)], 50);
    expect(v.used).toBe(2);
    expect(v.cap).toBe(50);
    expect(v.remaining).toBe(48);
    expect(v.level).toBe('ok');
  });

  it('turns amber at 70% and red at 90% — early enough to still act', () => {
    const many = (n: number) => Array.from({ length: n }, () => chan(false));
    expect(channelCeilingVerdict(many(34), 50).level).toBe('ok');
    expect(channelCeilingVerdict(many(35), 50).level).toBe('warn');
    expect(channelCeilingVerdict(many(45), 50).level).toBe('critical');
  });

  it('surfaces how many slots are reclaimable, which is the admin’s way out', () => {
    const v = channelCeilingVerdict([chan(false), chan(true), chan(true)], 50);
    expect(v.reclaimable).toBe(2);
  });
});
