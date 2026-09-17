/**
 * 🔴 ADMIN MONITOR CAPTURE, 2026-09-17 — the publish ceiling was reported twice on one screen, with
 * two different numbers, and its advice named a switch that had already been thrown.
 *
 * From the capture, both panels reading the same channel list at the same instant:
 *
 *     Publish load      44 / 50 channels   "Approaching the channel ceiling. Bucket-only publishing
 *                                           takes no channel at all — that is the fix."
 *     Published Apps    43 / 50            "7 more can be published · 34 reclaimable"
 *
 * Two defects, one panel:
 *
 *  1. THE COUNT. The load board counted `channels.length`, which includes the site's own `live`
 *     channel — and the cap is on PREVIEW channels, which `live` is not. `channelCeilingVerdict`
 *     had fixed this exact off-by-one on 2026-09-14 ("with it counted, 'N of about 50' was off by
 *     one on every site, always"); the board kept the old arithmetic. The drifted-sibling class.
 *  2. THE ADVICE. `PUBLISHED_APPS_BUCKET_ONLY=on` went live in production on 2026-09-17, verified on
 *     a real published app. With it on, a new publish takes no channel, so the number cannot grow —
 *     but the note still sent the admin to switch on a thing that was already on, and never named
 *     the action that WOULD move the number: reclaiming the channels no live app is using.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBoard } from '../src/server/lib/loadBoard';
import { channelCeilingVerdict, isDefaultChannel, type ClassifiedChannel } from '../src/server/AgentV3/channelInventory';

const publishTile = (r: Parameters<typeof loadBoard>[0]) => {
  const tile = loadBoard(r).find((t) => t.id === 'publish');
  expect(tile, 'no publish tile').toBeTruthy();
  return tile!;
};

/** The capture's own shape: 43 preview channels plus the site's `live` channel = 44 listed. */
const CAPTURE_CHANNELS = [
  { channelId: 'live' },
  ...Array.from({ length: 43 }, (_, i) => ({ channelId: `sn-agentv3-cap${i}-0000` })),
];

describe('🔴 the count: the cap is on PREVIEW channels, and `live` is not one', () => {
  it('the route\'s filter yields exactly what the card counts — 43, not 44', () => {
    const previews = CAPTURE_CHANNELS.filter((c) => !isDefaultChannel(c.channelId));
    expect(CAPTURE_CHANNELS).toHaveLength(44); // what the API lists
    expect(previews).toHaveLength(43);         // what the ceiling is measured in

    // …and it is the SAME number the Publish Capacity card shows, which is the whole point: one
    // screen may not carry two answers to one question.
    const classified: ClassifiedChannel[] = CAPTURE_CHANNELS.map((c) => ({
      channelId: c.channelId,
      url: '',
      updateTime: null,
      state: isDefaultChannel(c.channelId) ? 'default' : 'unknown',
      workspaceId: null,
      reclaimable: !isDefaultChannel(c.channelId),
    }));
    expect(channelCeilingVerdict(classified, 50).used).toBe(previews.length);
  });

  it('43 of 50 renders as the card renders it', () => {
    expect(publishTile({ publishChannels: 43, publishChannelsCap: 50 }).display).toBe('43 / 50 channels');
  });

  it('🔒 the route filters the default channel out before the board ever sees it', () => {
    // `loadBoard` is pure and cannot know which channel is which — the filter has to be at the read,
    // and nothing the board asserts would notice if it were dropped. This is the guard for that seam.
    const src = readFileSync(resolve(__dirname, '../src/server/routes/admin.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    const at = code.indexOf('readings.publishChannels =');
    expect(at, 'the publish reading was not found').toBeGreaterThan(-1);
    const stmt = code.slice(at, code.indexOf(';', at));
    expect(stmt).toContain('isDefaultChannel');
    // REVERSION GUARD: the exact expression that produced 44.
    expect(stmt).not.toMatch(/=\s*chan\.channels\.length/);
  });

  it('🔒 an unreadable list is still UNKNOWN, never zero', () => {
    const tile = publishTile({ publishChannels: null, publishChannelsCap: 50 });
    expect(tile.level).toBe('unknown');
    // `displayOf` says "unknown <unit>", as every other unreadable tile on the board does.
    expect(tile.display).toBe('unknown channels');
    expect(tile.display).not.toContain('0');
  });
});

describe('🔴 the advice: a note may not prescribe work already done', () => {
  const NEAR = { publishChannels: 43, publishChannelsCap: 50 };

  it('with bucket-only ON, it says the ceiling cannot grow and names the real action', () => {
    const note = publishTile({ ...NEAR, publishBucketOnly: true }).note;
    expect(note).toContain('can no longer grow');
    expect(note).toContain('reclaiming');
    // REVERSION GUARD: the sentence that sent the admin to flip a live switch.
    expect(note).not.toContain('that is the fix');
  });

  it('with bucket-only OFF, today\'s wording is unchanged — it is still the fix there', () => {
    const note = publishTile({ ...NEAR, publishBucketOnly: false }).note;
    expect(note).toContain('Bucket-only publishing takes no channel at all — that is the fix.');
  });

  it('a caller that does not know says nothing new — undefined is today exactly', () => {
    expect(publishTile({ ...NEAR }).note).toBe(publishTile({ ...NEAR, publishBucketOnly: false }).note);
    const ok = { publishChannels: 4, publishChannelsCap: 50 };
    expect(publishTile(ok).note).toBe(publishTile({ ...ok, publishBucketOnly: false }).note);
  });

  it('a healthy board with bucket-only on still says so, without alarm', () => {
    const tile = publishTile({ publishChannels: 4, publishChannelsCap: 50, publishBucketOnly: true });
    expect(tile.level).toBe('ok');
    expect(tile.note).toContain('bucket-only publishing is on');
  });

  it('⚠️ the flag changes the WORDS only — never the level', () => {
    // Stated because the tempting next edit is to grade a frozen ceiling as ok. It is not ours to
    // decide: 43 of 50 channels really are in use, and the backlog is real work.
    for (const r of [NEAR, { publishChannels: 48, publishChannelsCap: 50 }]) {
      expect(publishTile({ ...r, publishBucketOnly: true }).level).toBe(publishTile(r).level);
    }
  });

  it('🔒 the route reads the real flag rather than assuming it', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/routes/admin.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(code).toContain('readings.publishBucketOnly = bucketOnlyPublishEnabled()');
  });
});
