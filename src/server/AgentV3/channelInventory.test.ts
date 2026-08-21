import { describe, it, expect, afterEach } from 'vitest';
import {
  classifyChannels, channelCeilingVerdict, channelCap, channelIdFromResourceName,
  isChannelQuotaError, HOSTING_FULL_MESSAGE,
} from './channelInventory';
import { makeChannelId } from './Deployment';

/**
 * THE PUBLISH CEILING (ROADMAP §10). Every published app holds ONE Firebase Hosting channel and the
 * pool is capped per site. Past the cap, publishing stops for EVERY user at once — and until this
 * existed, nothing on our side could see it coming: our registry counts apps we know about, while the
 * cap counts channels that EXIST, and those two genuinely drifted apart.
 *
 * They drifted for a concrete reason. A purge before `markOrphaned` (2026-08-21) deleted the
 * deployment record outright and never touched the channel. Those apps are still serving, invisible
 * to every count we had, and still spending the scarce resource.
 */
const rec = (workspaceId: string, status = 'active') => ({
  workspaceId, status, url: `https://p--${workspaceId}.web.app`, sizeMb: 1,
}) as never;
const ch = (channelId: string) => ({ channelId, url: `https://x-${channelId}.web.app`, updateTime: '2026-08-01T00:00:00Z' });

describe('channelIdFromResourceName', () => {
  it('pulls the id out of the full resource name the API returns', () => {
    expect(channelIdFromResourceName('sites/my-site/channels/v3-abc-123')).toBe('v3-abc-123');
  });

  it('returns empty for nothing usable rather than a misleading fragment', () => {
    expect(channelIdFromResourceName('')).toBe('');
    expect(channelIdFromResourceName(null)).toBe('');
    expect(channelIdFromResourceName(undefined)).toBe('');
  });
});

describe('classifyChannels — reconciling what EXISTS against what we know about', () => {
  it('a channel whose record is live is LIVE, and is NOT reclaimable', () => {
    const [c] = classifyChannels([ch(makeChannelId('ws-a'))], [rec('ws-a')]);
    expect(c.state).toBe('live');
    expect(c.workspaceId).toBe('ws-a');
    expect(c.reclaimable).toBe(false);
  });

  it('THE ORPHAN CASE: a channel with NO record at all is UNKNOWN and reclaimable', () => {
    // This is the damage the old purge did — an app still serving that nothing points at. The channel
    // id is a one-way hash of the workspace id, so it genuinely cannot be traced back; saying so
    // honestly is what lets it be cleaned up rather than quietly tolerated.
    const [c] = classifyChannels([ch('v3-gone-deadbeef1234')], [rec('ws-a')]);
    expect(c.state).toBe('unknown');
    expect(c.workspaceId).toBeNull();
    expect(c.reclaimable).toBe(true);
  });

  it('A LEAK SIGNAL: a record that is not live while its channel still exists is STALE', () => {
    // Unpublish and takedown both delete the channel BEFORE touching the registry, so this state
    // means one of those deletes failed and reported success somewhere.
    for (const status of ['unpublished', 'taken_down', 'held']) {
      const [c] = classifyChannels([ch(makeChannelId('ws-b'))], [rec('ws-b', status)]);
      expect(c.state, status).toBe('stale');
      expect(c.reclaimable, status).toBe(true);
    }
  });

  it('lists WASTE first — that is what the screen exists to act on', () => {
    const out = classifyChannels(
      [ch(makeChannelId('ws-a')), ch('v3-orphan-000000000000'), ch(makeChannelId('ws-b'))],
      [rec('ws-a'), rec('ws-b', 'unpublished')],
    );
    expect(out.map((c) => c.state)).toEqual(['unknown', 'stale', 'live']);
  });

  it('de-duplicates by channel id, so a paginated repeat cannot inflate the count', () => {
    // The count is the whole point of this module; counting one channel twice would raise a false
    // alarm, and the fix for a false alarm is usually to stop trusting the alarm.
    const id = makeChannelId('ws-a');
    expect(classifyChannels([ch(id), ch(id)], [rec('ws-a')])).toHaveLength(1);
  });

  it('survives empty and malformed input rather than throwing at the admin', () => {
    expect(classifyChannels([], [])).toEqual([]);
    expect(classifyChannels(null, null)).toEqual([]);
    expect(classifyChannels([{ channelId: '' }], [])).toEqual([]);
    expect(classifyChannels([ch('v3-x')], [{ status: 'active' } as never])).toHaveLength(1);
  });
});

describe('channelCap — a number we are honest about not knowing', () => {
  afterEach(() => { delete process.env.HOSTING_CHANNEL_CAP; });

  it('defaults to the working figure of 50', () => {
    // Google does not publish this on its Hosting quota page; ~50 is a 2020 community report. It is
    // env-tunable precisely BECAUSE it is a guess — the first real "quota reached" settles it.
    expect(channelCap()).toBe(50);
  });

  it('is env-tunable', () => {
    process.env.HOSTING_CHANNEL_CAP = '200';
    expect(channelCap()).toBe(200);
  });

  it('an empty or malformed value falls back to 50, NEVER to zero', () => {
    // `Number('')` is 0 and finite — a cap of 0 would report the platform as permanently full.
    process.env.HOSTING_CHANNEL_CAP = '';
    expect(channelCap()).toBe(50);
    process.env.HOSTING_CHANNEL_CAP = 'fifty';
    expect(channelCap()).toBe(50);
    process.env.HOSTING_CHANNEL_CAP = '-3';
    expect(channelCap()).toBe(50);
  });
});

describe('channelCeilingVerdict — the warning must arrive BEFORE the wall', () => {
  const live = (n: number) => Array.from({ length: n }, (_, i) => ch(makeChannelId(`w${i}`)));
  const recs = (n: number) => Array.from({ length: n }, (_, i) => rec(`w${i}`));
  const at = (n: number) => classifyChannels(live(n), recs(n));

  it('is quiet while there is real room', () => {
    const v = channelCeilingVerdict(at(10), 50);
    expect(v.level).toBe('ok');
    expect(v).toMatchObject({ used: 10, cap: 50, remaining: 40, reclaimable: 0 });
  });

  it('warns at 70% and goes critical at 90% — while publishing still WORKS', () => {
    // A warning that arrives once publishing is already broken is not a warning.
    expect(channelCeilingVerdict(at(35), 50).level).toBe('warn');
    expect(channelCeilingVerdict(at(45), 50).level).toBe('critical');
    expect(channelCeilingVerdict(at(45), 50).remaining).toBe(5); // there IS still room to act
  });

  it('counts reclaimable slots, because that is the fix available today', () => {
    const classified = classifyChannels(
      [...live(3), ch('v3-orphan-aaaaaaaaaaaa'), ch('v3-orphan-bbbbbbbbbbbb')],
      recs(3),
    );
    const v = channelCeilingVerdict(classified, 50);
    expect(v.used).toBe(5);
    expect(v.reclaimable).toBe(2);
    expect(v.message).toContain('2 of them belong to no live app');
  });

  it('says it in plain English an admin does not have to interpret', () => {
    expect(channelCeilingVerdict(at(46), 50).message)
      .toContain('Publishing is close to stopping for everyone');
    expect(channelCeilingVerdict(at(1), 50).message).not.toContain('close to stopping');
  });

  it('never reports negative room once the cap is passed', () => {
    const v = channelCeilingVerdict(at(60), 50);
    expect(v.remaining).toBe(0);
    expect(v.level).toBe('critical');
  });
});

/**
 * WHAT THE USER SEES WHEN THE CEILING ARRIVES.
 *
 * This is the one moment the ceiling becomes visible to a real person, and it is entirely OUR
 * problem, not theirs. The raw failure names the vendor and an IAM role — and it is handed to the
 * agent to paraphrase back to the user, so without this it reached them as a confusing accusation
 * AND as a white-label leak.
 */
describe('isChannelQuotaError — telling "we are full" apart from "we did something wrong"', () => {
  it('recognises the ways a quota failure announces itself', () => {
    expect(isChannelQuotaError(429, {})).toBe(true);
    expect(isChannelQuotaError(400, { error: { status: 'RESOURCE_EXHAUSTED' } })).toBe(true);
    expect(isChannelQuotaError(400, { error: { message: 'Quota exceeded for channels' } })).toBe(true);
    expect(isChannelQuotaError(400, 'maximum number of channels reached')).toBe(true);
  });

  it('does NOT claim the platform is full for a failure that is our own bug', () => {
    // A false positive tells a user we are out of room when the real cause was ours — worse than the
    // ugly generic error, because it sends them away instead of getting the bug fixed.
    expect(isChannelQuotaError(403, { error: { message: 'Permission denied' } })).toBe(false);
    expect(isChannelQuotaError(400, { error: { message: 'Unknown name "type" at \'channel\'' } })).toBe(false);
    expect(isChannelQuotaError(404, {})).toBe(false);
    expect(isChannelQuotaError(500, {})).toBe(false);
    expect(isChannelQuotaError(null, null)).toBe(false);
  });
});

describe('HOSTING_FULL_MESSAGE — honest, and white-label clean', () => {
  it('names NO vendor or model — the user only ever deals with NavBharatAI', () => {
    const forbidden = /firebase|google|cloud run|hosting admin|iam|gcp|channel/i;
    expect(HOSTING_FULL_MESSAGE).not.toMatch(forbidden);
    expect(HOSTING_FULL_MESSAGE).toContain('NavBharatAI');
  });

  it('says what is NOT lost, and gives a way forward that works this minute', () => {
    // "Try later" alone would strand someone who needs their app live today; their own free host is
    // available from the same screen and has no limit from us at all.
    expect(HOSTING_FULL_MESSAGE).toContain('Nothing was lost');
    expect(HOSTING_FULL_MESSAGE).toContain('Vercel');
  });

  it('does not blame the user for a platform limit', () => {
    expect(HOSTING_FULL_MESSAGE).not.toMatch(/you have (reached|used)|your limit|too many apps/i);
  });
});
