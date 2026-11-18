/**
 * A PREVIEW IS NEVER BLANK (admin 2026-11-17: a three-day-old game "1 second bhi nahi chala").
 * The last build had FAILED after changing files, so its copy was "not current"; the door refused the older
 * copy and the machine never answered. Now an older copy stands in — said to be older — once nobody is
 * waiting for a fresh edit, and never while a build runs.
 */
import { describe, expect, it } from 'vitest';
import {
  OLDER_STANDIN_QUIET_MS, SNAPSHOT_NOTE, SNAPSHOT_OLDER_NOTE, SNAPSHOT_WAKING_NOTE,
  shouldServeSnapshot, snapshotStandIn, snapshotStandInNote,
} from './previewSnapshot';

const URL = 'https://navbharatai-3395f--sn-agentv3-abc.web.app';
const DAY = 24 * 60 * 60_000;
const now = 1_800_000_000_000;
const base = { enabled: true, doorState: 'starting' as const, snapshotUrl: URL, now };

describe('the copy that stands in for a starting preview', () => {
  it('the reported case: copy from build 2, files changed by failed build 3, opened 3 days later → the older copy, labelled', () => {
    const kind = snapshotStandIn({ ...base, snapshotAt: now - 3 * DAY - 3 * 3600_000, lastChangeAt: now - 3 * DAY });
    expect(kind).toBe('older');
    expect(snapshotStandInNote(kind!)).toBe(SNAPSHOT_OLDER_NOTE);
    expect(SNAPSHOT_OLDER_NOTE).toMatch(/not in this copy/);
  });

  it('a just-made edit is never hidden behind an old copy (inside the quiet period)', () => {
    expect(snapshotStandIn({ ...base, snapshotAt: now - DAY, lastChangeAt: now - OLDER_STANDIN_QUIET_MS + 1000 })).toBeNull();
    expect(snapshotStandIn({ ...base, snapshotAt: now - DAY, lastChangeAt: now - OLDER_STANDIN_QUIET_MS })).toBe('older');
  });

  it('never while a build is running for this workspace', () => {
    expect(snapshotStandIn({ ...base, snapshotAt: now - 3 * DAY, lastChangeAt: now - 2 * DAY, buildRunning: true })).toBeNull();
  });

  it('an undatable last write with no build running still gets the older copy, never a blank pane', () => {
    expect(snapshotStandIn({ ...base, snapshotAt: now - 3 * DAY, lastChangeAt: null })).toBe('older');
  });

  it('a current copy stays "current", and a gone machine stays "expired", with their own notes', () => {
    expect(snapshotStandInNote(snapshotStandIn({ ...base, snapshotAt: now - 1000, lastChangeAt: now - 2000 })!)).toBe(SNAPSHOT_WAKING_NOTE);
    expect(snapshotStandInNote(snapshotStandIn({ ...base, doorState: 'asleep', snapshotAt: null })!)).toBe(SNAPSHOT_NOTE);
  });

  it('no copy, a bad url or the kill switch → nothing to stand in', () => {
    expect(snapshotStandIn({ ...base, snapshotUrl: null })).toBeNull();
    expect(snapshotStandIn({ ...base, snapshotUrl: 'javascript:alert(1)' })).toBeNull();
    expect(snapshotStandIn({ ...base, enabled: false, snapshotAt: now - 3 * DAY, lastChangeAt: now - 2 * DAY })).toBeNull();
  });

  it('the old boolean answer is unchanged for its remaining caller (the gone-machine door branch)', () => {
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: URL })).toBe(true);
  });
});
