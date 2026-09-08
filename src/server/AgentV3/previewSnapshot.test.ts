import { describe, it, expect } from 'vitest';
import {
  previewSnapshotEnabled, snapshotChannelId, snapshotSuitable, shouldServeSnapshot, SNAPSHOT_NOTE,
  snapshotStillCurrent, SNAPSHOT_WAKING_NOTE,
} from './previewSnapshot';
import { makeChannelId } from './Deployment';
import { packageJson } from './sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

describe('snapshotChannelId — never the channel somebody deliberately published to', () => {
  it('differs from the publish channel for the same workspace', () => {
    // THE LOAD-BEARING DECISION. Sharing a channel would mean an edit that broke the app silently
    // REPLACED the working version the user had chosen to ship.
    const ws = 'agentv3-uid123-session456';
    expect(snapshotChannelId(ws)).not.toBe(makeChannelId(ws));
  });

  it('is deterministic and stays inside the id budget', () => {
    const ws = 'agentv3-a-very-long-user-id-and-session-that-goes-on-and-on';
    expect(snapshotChannelId(ws)).toBe(snapshotChannelId(ws));
    expect(snapshotChannelId(ws).length).toBeLessThanOrEqual(33);
    expect(snapshotChannelId(ws)).toMatch(/^sn-[a-z0-9-]+$/);
  });

  it('two different workspaces never collide', () => {
    expect(snapshotChannelId('ws-a')).not.toBe(snapshotChannelId('ws-b'));
  });
});

describe('snapshotSuitable — a static copy must not pretend to be a server', () => {
  it('our own vite-react scaffold is suitable', () => {
    expect(snapshotSuitable(packageJson)).toBe(true);
  });

  it('refuses an app whose server runs inside the sandbox', () => {
    // A static copy of one of these renders the shell and fails every request behind it — an app that
    // LOOKS alive and does nothing, which is worse than an honest "this preview has expired".
    for (const pkg of [
      '{"scripts":{"build":"vite build","start":"node server.js"}}',
      '{"scripts":{"build":"next build","start":"next start"}}',
      '{"scripts":{"build":"tsc"},"dependencies":{"express":"^4"}}',
      '{"scripts":{"build":"vite build"},"dependencies":{"fastify":"^4"}}',
      '{"scripts":{"build":"vite build","serve":"uvicorn main:app"}}',
    ]) {
      expect(snapshotSuitable(pkg), pkg).toBe(false);
    }
  });

  it('refuses an app with no build script at all — there is nothing to snapshot', () => {
    expect(snapshotSuitable('{"scripts":{}}')).toBe(false);
    expect(snapshotSuitable('{"scripts":{"build":"   "}}')).toBe(false);
  });

  it('is false rather than throwing on junk', () => {
    expect(snapshotSuitable('{ not json')).toBe(false);
    expect(snapshotSuitable(null)).toBe(false);
    expect(snapshotSuitable('')).toBe(false);
  });
});

describe('shouldServeSnapshot — always when the machine is gone, and while it STARTS only on proof', () => {
  const url = 'https://site--sn-abc-123.web.app';
  const TAKEN = 1_700_000_000_000;

  it('serves it when there is no sandbox at all', () => {
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: url })).toBe(true);
  });

  it('a starting machine with NO evidence still gets the waiting page — unchanged, and why', () => {
    // REPOINTED, NOT RELAXED (2026-09-08). This case used to be a blanket refusal of 'starting', on the
    // reasoning that such a machine "is usually seconds from answering" so a stale copy would lose the
    // edits the user is waiting to see. The first half stopped being true when the wake budget went
    // from 90 seconds to ten minutes for a cold install (previewWake.ts); the second half is real, and
    // is now answered with EVIDENCE instead of a refusal. With no stamps to check there is no evidence,
    // so the original outcome stands exactly — which is what this line still pins.
    expect(shouldServeSnapshot({ enabled: true, doorState: 'starting', snapshotUrl: url })).toBe(false);
  });

  it('serves it while starting when nothing has changed since it was taken', () => {
    expect(shouldServeSnapshot({
      enabled: true, doorState: 'starting', snapshotUrl: url, snapshotAt: TAKEN, lastChangeAt: TAKEN - 60_000,
    })).toBe(true);
    // The boundary: a write in the same millisecond as the snapshot is not a later app.
    expect(shouldServeSnapshot({
      enabled: true, doorState: 'starting', snapshotUrl: url, snapshotAt: TAKEN, lastChangeAt: TAKEN,
    })).toBe(true);
  });

  it('🔒 refuses the moment anything was written after it — the edits the user is waiting for', () => {
    expect(shouldServeSnapshot({
      enabled: true, doorState: 'starting', snapshotUrl: url, snapshotAt: TAKEN, lastChangeAt: TAKEN + 1,
    })).toBe(false);
  });

  it('🔒 an unknown stamp is NOT proof — either one missing means the waiting page', () => {
    for (const bad of [null, undefined, 0, -1, NaN, 'yesterday' as unknown as number]) {
      expect(shouldServeSnapshot({
        enabled: true, doorState: 'starting', snapshotUrl: url, snapshotAt: TAKEN, lastChangeAt: bad,
      }), `lastChangeAt=${String(bad)}`).toBe(false);
      expect(shouldServeSnapshot({
        enabled: true, doorState: 'starting', snapshotUrl: url, snapshotAt: bad, lastChangeAt: TAKEN,
      }), `snapshotAt=${String(bad)}`).toBe(false);
    }
  });

  it('the stamps never affect the ASLEEP case — a gone machine has no live app to lose edits to', () => {
    expect(shouldServeSnapshot({
      enabled: true, doorState: 'asleep', snapshotUrl: url, snapshotAt: TAKEN, lastChangeAt: TAKEN + 999_999,
    })).toBe(true);
  });

  it('does nothing without a snapshot, or with a junk one', () => {
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: null })).toBe(false);
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: '' })).toBe(false);
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: 'not-a-url' })).toBe(false);
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: 'javascript:alert(1)' })).toBe(false);
    // …and a junk url is refused on the starting path too, however good the evidence.
    expect(shouldServeSnapshot({
      enabled: true, doorState: 'starting', snapshotUrl: 'javascript:alert(1)', snapshotAt: TAKEN, lastChangeAt: TAKEN - 1,
    })).toBe(false);
  });

  it('the kill switch restores the retry page — on BOTH paths', () => {
    expect(shouldServeSnapshot({ enabled: false, doorState: 'asleep', snapshotUrl: url })).toBe(false);
    expect(shouldServeSnapshot({
      enabled: false, doorState: 'starting', snapshotUrl: url, snapshotAt: TAKEN, lastChangeAt: TAKEN - 1,
    })).toBe(false);
  });
});

describe('snapshotStillCurrent — the evidence the starting case rests on', () => {
  const TAKEN = 1_700_000_000_000;

  it('true only when the last write is not newer than the snapshot', () => {
    expect(snapshotStillCurrent(TAKEN, TAKEN - 1)).toBe(true);
    expect(snapshotStillCurrent(TAKEN, TAKEN)).toBe(true);
    expect(snapshotStillCurrent(TAKEN, TAKEN + 1)).toBe(false);
  });

  it('🔒 unknown is never proof — the direction that costs a spinner, never a wrong app', () => {
    expect(snapshotStillCurrent(TAKEN, null)).toBe(false);
    expect(snapshotStillCurrent(null, TAKEN)).toBe(false);
    expect(snapshotStillCurrent(undefined, undefined)).toBe(false);
    expect(snapshotStillCurrent(0, 0)).toBe(false);
    expect(snapshotStillCurrent(NaN, NaN)).toBe(false);
  });
});

describe('what the user is told', () => {
  it('says it is the LAST BUILT version and how to get the live one back', () => {
    expect(SNAPSHOT_NOTE).toContain('last built version');
    expect(SNAPSHOT_NOTE).toContain('Send a message');
  });

  it('never implies the app is broken, and names no vendor or machine', () => {
    expect(SNAPSHOT_NOTE).not.toMatch(/error|broken|failed|crash/i);
    expect(SNAPSHOT_NOTE).not.toMatch(/e2b|sandbox|firebase|hosting|vm|container/i);
  });

  it('the WAKING note says the copy is current and that the live one arrives by itself', () => {
    // It is only ever shown when nothing changed since the snapshot, so calling it "the last built
    // version" here would invent a worry the evidence has already ruled out. And the user must not be
    // asked to do anything: the swap is automatic.
    expect(SNAPSHOT_WAKING_NOTE).toContain('current app');
    expect(SNAPSHOT_WAKING_NOTE).toMatch(/by itself/i);
    expect(SNAPSHOT_WAKING_NOTE).not.toContain('last built version');
    expect(SNAPSHOT_WAKING_NOTE).not.toMatch(/expired|Send a message/i);
  });

  it('the two notes are genuinely different — one for a gone machine, one for a starting one', () => {
    expect(SNAPSHOT_WAKING_NOTE).not.toBe(SNAPSHOT_NOTE);
  });

  it('the waking note never implies a fault, and names no vendor or machine', () => {
    expect(SNAPSHOT_WAKING_NOTE).not.toMatch(/error|broken|failed|crash/i);
    expect(SNAPSHOT_WAKING_NOTE).not.toMatch(/e2b|sandbox|firebase|hosting|vm|container/i);
  });
});

describe('configuration', () => {
  it('is on by default, off only for the explicit kill switch', () => {
    expect(previewSnapshotEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(previewSnapshotEnabled({ AGENTV3_PREVIEW_SNAPSHOT: 'off' } as never)).toBe(false);
  });
});
