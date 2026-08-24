import { describe, it, expect } from 'vitest';
import { canServeFromSnapshot, SNAPSHOT_TRUST_MS, SNAPSHOT_IDLE_NOTE } from './snapshotServeDecision';

const NOW = 1_787_600_000_000;
const ok = {
  buildRunning: false,
  snapshotUrl: 'https://site--sn-abc.web.app',
  snapshotAt: NOW - 60_000,
  now: NOW,
};

describe('the lever this exists for', () => {
  it('lets a finished app be served without touching its machine', () => {
    // Measured: 1,257 sandboxes billed 1,498 vCPU-hours — 1.19h each, for builds of 3-18 minutes. The
    // health probe runs a sandbox command every 150s and any sandbox command resets the idle clock, so
    // an open preview tab bills for as long as it is open. This is what lets the sweep finally win.
    expect(canServeFromSnapshot(ok)).toBe(true);
  });
});

describe('every condition is a reason NOT to — the default stays today’s behaviour', () => {
  it('never while a build is running — the machine IS the work', () => {
    expect(canServeFromSnapshot({ ...ok, buildRunning: true })).toBe(false);
  });

  it('never without a real snapshot', () => {
    expect(canServeFromSnapshot({ ...ok, snapshotUrl: null })).toBe(false);
    expect(canServeFromSnapshot({ ...ok, snapshotUrl: '' })).toBe(false);
    expect(canServeFromSnapshot({ ...ok, snapshotUrl: 'not-a-url' })).toBe(false);
    expect(canServeFromSnapshot({ ...ok, snapshotUrl: 'javascript:alert(1)' })).toBe(false);
  });

  it('never without a usable timestamp — "we do not know when" is not "recent"', () => {
    expect(canServeFromSnapshot({ ...ok, snapshotAt: null })).toBe(false);
    expect(canServeFromSnapshot({ ...ok, snapshotAt: 0 })).toBe(false);
    expect(canServeFromSnapshot({ ...ok, snapshotAt: NaN })).toBe(false);
  });

  it('never past the trust window', () => {
    expect(canServeFromSnapshot({ ...ok, snapshotAt: NOW - SNAPSHOT_TRUST_MS - 1 })).toBe(false);
    expect(canServeFromSnapshot({ ...ok, snapshotAt: NOW - SNAPSHOT_TRUST_MS + 1 })).toBe(true);
  });

  it('never when the clock went backwards', () => {
    expect(canServeFromSnapshot({ ...ok, snapshotAt: NOW + 60_000 })).toBe(false);
  });

  it('never when the app changed AFTER the snapshot was taken', () => {
    // A snapshot older than the user's latest edit is the WRONG app to show, however cheap it is.
    expect(canServeFromSnapshot({ ...ok, lastChangeAt: NOW - 30_000 })).toBe(false);
    expect(canServeFromSnapshot({ ...ok, lastChangeAt: NOW - 90_000 })).toBe(true);
  });

  it('survives junk without throwing', () => {
    expect(canServeFromSnapshot({} as never)).toBe(false);
    expect(canServeFromSnapshot(undefined as never)).toBe(false);
  });
});

describe('what the user is told', () => {
  it('reads as a choice, not a fault — and names the one surprising thing', () => {
    expect(SNAPSHOT_IDLE_NOTE).not.toMatch(/error|broken|failed|expired|problem/i);
    expect(SNAPSHOT_IDLE_NOTE).toContain('Send any change');
  });

  it('names no vendor or machine', () => {
    expect(SNAPSHOT_IDLE_NOTE).not.toMatch(/e2b|sandbox|firebase|vm|container|hosting/i);
  });
});
