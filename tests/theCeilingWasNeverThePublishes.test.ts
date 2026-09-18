/**
 * 🔴 ADMIN MONITOR CAPTURE, 2026-09-18 — bucket-only publishing had been live and verified for a day,
 * and the channel count still climbed: 43 → 46, with the flag on.
 *
 * Every id in the admin's "wasted channels" list began `sn-`, which is `snapshotChannelId`, not
 * `makeChannelId`. **The pool was being eaten by preview SNAPSHOTS, not by published apps.**
 *
 * A snapshot is the saved `dist/` of a green build, kept so a finished app outlives its sandbox. Three
 * facts, and together they explain the whole tile:
 *
 *   1. One is created on every green build, and NOTHING in the server ever deletes one.
 *   2. The bucket branch in `deployStatic` was gated on the channel being the PUBLISH channel, so no
 *      amount of bucket-only publishing could touch them.
 *   3. A snapshot never has a deployment record, so the inventory called it an orphaned app and told
 *      the admin "its chat and record are gone, but the app is still live" — about a build cache.
 */
import { describe, it, expect } from 'vitest';
import {
  snapshotSubdomain, isSnapshotSubdomain, bucketOnlySubdomain, isBucketOnlySubdomain,
  snapshotBucketEnabled, bucketOnlyPublishEnabled, SNAPSHOT_BUCKET_PREFIX, BUCKET_ONLY_PREFIX,
} from '../src/server/AgentV3/bucketOnlyPublish';
import { snapshotChannelId, isSnapshotChannelId } from '../src/server/AgentV3/previewSnapshot';
import { makeChannelId } from '../src/server/AgentV3/Deployment';
import { classifyChannels, channelCeilingVerdict } from '../src/server/AgentV3/channelInventory';

const WS = 'agentv3-AV12sjkLsug7tqTANiHHqguKKE52-89faf49e';
/** The three env values bucket serving needs, all of them, as production has them. */
const ENV = {
  PUBLISHED_APPS_BUCKET: 'navbharatai-published-apps',
  PUBLISHED_APP_DOMAIN: 'mitrify.in',
  PUBLISHED_APPS_BUCKET_ONLY: 'on',
} as NodeJS.ProcessEnv;

describe('the three namespaces cannot overlap', () => {
  it('a publish, a snapshot and a Firebase channel are each in their own space', () => {
    expect(makeChannelId(WS)).toMatch(/^v3-/);
    expect(snapshotChannelId(WS)).toMatch(/^sn-/);
    expect(bucketOnlySubdomain(WS)).toMatch(new RegExp(`^${BUCKET_ONLY_PREFIX}`));
    expect(snapshotSubdomain(WS)).toMatch(new RegExp(`^${SNAPSHOT_BUCKET_PREFIX}`));
    // The one that matters: a snapshot must never be able to overwrite a published app's objects.
    expect(snapshotSubdomain(WS)).not.toBe(bucketOnlySubdomain(WS));
    expect(isBucketOnlySubdomain(snapshotSubdomain(WS))).toBe(false);
    expect(isSnapshotSubdomain(bucketOnlySubdomain(WS))).toBe(false);
  });

  it('a snapshot subdomain is deterministic, so a rebuild overwrites instead of accumulating', () => {
    expect(snapshotSubdomain(WS)).toBe(snapshotSubdomain(WS));
    expect(snapshotSubdomain('other')).not.toBe(snapshotSubdomain(WS));
  });

  it('it is DNS-safe and inside a label, like the publish one', () => {
    const sub = snapshotSubdomain(WS);
    expect(sub).toMatch(/^[a-z0-9-]+$/);
    expect(sub.length).toBeLessThanOrEqual(63);
  });
});

describe('🔒 the switch: snapshots can be reverted without touching publishing', () => {
  it('follows bucket-only publishing when nothing says otherwise', () => {
    expect(snapshotBucketEnabled(ENV)).toBe(true);
    expect(bucketOnlyPublishEnabled(ENV)).toBe(true);
  });

  it('AGENTV3_SNAPSHOT_BUCKET=off reverts SNAPSHOTS alone', () => {
    const env = { ...ENV, AGENTV3_SNAPSHOT_BUCKET: 'off' };
    expect(snapshotBucketEnabled(env)).toBe(false);
    expect(bucketOnlyPublishEnabled(env)).toBe(true); // publishing is untouched
  });

  it('a half-configured bucket serves NEITHER — a dead link is worse than a channel', () => {
    for (const missing of ['PUBLISHED_APPS_BUCKET', 'PUBLISHED_APP_DOMAIN', 'PUBLISHED_APPS_BUCKET_ONLY']) {
      const env = { ...ENV, [missing]: '' };
      expect(snapshotBucketEnabled(env), missing).toBe(false);
    }
  });

  it('🔒 the deploy path routes BOTH ids through one branch, never two copies', () => {
    // `deployStatic` picks the subdomain and shares everything after it. A second copy of that block
    // is exactly how the publish and snapshot paths would drift, which is what this whole autopsy is.
    const src = readSource('../src/server/AgentV3/Deployment.ts');
    expect(src).toContain('const bucketSub =');
    expect(src).toContain('snapshotChannelId(workspaceId) && snapshotBucketEnabled()');
    expect(src).toContain('snapshotSubdomain(workspaceId)');
    // REVERSION GUARD: the gate that let snapshots through to Firebase.
    expect(src).not.toContain('if (channelId === makeChannelId(workspaceId) && bucketOnlyPublishEnabled()) {');
  });
});

describe('🔴 the inventory calls a build copy what it is', () => {
  /** The capture's shape: the site channel, one real published app, and a pile of snapshots. */
  const capture = [
    { channelId: 'live' },
    { channelId: makeChannelId(WS) },
    ...Array.from({ length: 34 }, (_, i) => ({ channelId: snapshotChannelId(`ws-${i}`) })),
  ];

  it('a snapshot channel is recognised by its id, not by a missing record', () => {
    expect(isSnapshotChannelId(snapshotChannelId(WS))).toBe(true);
    expect(isSnapshotChannelId(makeChannelId(WS))).toBe(false);
    expect(isSnapshotChannelId('live')).toBe(false);
    expect(isSnapshotChannelId('')).toBe(false);
  });

  it('34 snapshots classify as snapshots, not as orphaned apps', () => {
    // Registry COMPLETE and empty: before this change, that combination is exactly what turned every
    // snapshot into `unknown`, which the card printed as "chat and record are gone".
    const out = classifyChannels(capture, [], true);
    const snaps = out.filter((c) => c.state === 'snapshot');
    expect(snaps).toHaveLength(34);
    // 🔑 THE WHOLE POINT: not one of them is `unknown` any more. The only `unknown` left is the real
    // published app, whose record genuinely is missing here — that state still means what it says.
    const unknowns = out.filter((c) => c.state === 'unknown');
    expect(unknowns.map((c) => c.channelId)).toEqual([makeChannelId(WS)]);
  });

  it('they still cost a slot, and they are still safe to reclaim', () => {
    const v = channelCeilingVerdict(classifyChannels(capture, [], true), 50);
    expect(v.used).toBe(35);        // 34 snapshots + 1 published app; `live` is not a preview channel
    expect(v.snapshots).toBe(34);
    expect(v.reclaimable).toBeGreaterThanOrEqual(34);
    expect(v.message).toContain('saved copies of builds');
  });

  it('🔒 the site\'s own channel is still checked FIRST and is never reclaimable', () => {
    const out = classifyChannels(capture, [], true);
    const def = out.find((c) => c.channelId === 'live');
    expect(def?.state).toBe('default');
    expect(def?.reclaimable).toBe(false);
  });

  it('🔒 an INCOMPLETE registry still refuses to call anything orphaned', () => {
    // The 2026-08-21 destructive bug. A snapshot is decided by its id so it is unaffected, but a real
    // app with an unread record must stay `indeterminate` and unreclaimable.
    const out = classifyChannels(capture, [], false);
    expect(out.find((c) => c.channelId === makeChannelId(WS))?.state).toBe('indeterminate');
    expect(out.find((c) => c.channelId === makeChannelId(WS))?.reclaimable).toBe(false);
    expect(out.filter((c) => c.state === 'snapshot')).toHaveLength(34);
  });

  it('a LIVE published app is never mistaken for a snapshot', () => {
    // `isLiveDeployment` wants a real url and an ACTIVE status — the record shape the store writes.
    const rec = [{ workspaceId: WS, status: 'active', url: 'https://a-abc.mitrify.in' }] as any[];
    const out = classifyChannels(capture, rec, true);
    const app = out.find((c) => c.channelId === makeChannelId(WS));
    expect(app?.state).toBe('live');
    expect(app?.reclaimable).toBe(false);
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolve } = require('node:path');
  return readFileSync(resolve(__dirname, rel), 'utf8');
}
