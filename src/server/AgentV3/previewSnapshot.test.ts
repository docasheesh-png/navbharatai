import { describe, it, expect } from 'vitest';
import {
  previewSnapshotEnabled, snapshotChannelId, snapshotSuitable, shouldServeSnapshot, SNAPSHOT_NOTE,
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

describe('shouldServeSnapshot — only when the machine is genuinely gone', () => {
  const url = 'https://site--sn-abc-123.web.app';

  it('serves it when there is no sandbox at all', () => {
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: url })).toBe(true);
  });

  it('does NOT serve it while a sandbox is still starting', () => {
    // That machine is usually seconds from answering. Replacing a live app that is still booting with
    // a STALE copy of itself would lose the very edits the user is waiting to see.
    expect(shouldServeSnapshot({ enabled: true, doorState: 'starting', snapshotUrl: url })).toBe(false);
  });

  it('does nothing without a snapshot, or with a junk one', () => {
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: null })).toBe(false);
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: '' })).toBe(false);
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: 'not-a-url' })).toBe(false);
    expect(shouldServeSnapshot({ enabled: true, doorState: 'asleep', snapshotUrl: 'javascript:alert(1)' })).toBe(false);
  });

  it('the kill switch restores the retry page', () => {
    expect(shouldServeSnapshot({ enabled: false, doorState: 'asleep', snapshotUrl: url })).toBe(false);
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
});

describe('configuration', () => {
  it('is on by default, off only for the explicit kill switch', () => {
    expect(previewSnapshotEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(previewSnapshotEnabled({ AGENTV3_PREVIEW_SNAPSHOT: 'off' } as never)).toBe(false);
  });
});
