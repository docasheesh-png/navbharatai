import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyPreviewHealth, planPreviewHealthProbe, previewHealthContextLine, shouldAutoRebootPreview as serverShouldReboot } from '../src/server/AgentV3/PreviewHealth';
import { shouldAutoRebootPreview, shouldRestorePreview } from '../src/components/agentv3/previewAutoReboot';
import {
  chooseLiveFrameSrc, framedSnapshotUrl, snapshotNoteAfterWakeFailures, wakeBannerCopy,
  WAKE_GAVE_UP_NOTE, WAKE_FAILURES_BEFORE_PLAIN_NOTE,
} from '../src/components/agentv3/previewWakeIntent';

/**
 * ONE "WAKE UP" PRESS REALLY BRINGS THE LIVE PREVIEW BACK (admin 2026-11-21).
 *
 * The admin pressed Wake up under "Preview is in sleep mode", saw a few seconds of loading, and the
 * live preview never came back — the frame stayed on "Showing your saved copy while the live preview
 * starts up … the live version takes over by itself the moment it is ready".
 *
 * The wake itself worked. What undid it, every time:
 *   1. the health route skipped the port check (a current saved copy exists) and classified "not
 *      checked" as 'sleeping' — so the very next check said asleep again;
 *   2. the frame's src led with the saved copy, which a successful wake never cleared;
 *   3. the watchdog took that false 'sleeping' as a reason to reboot every 180 s, up to ten times.
 *
 * The CLASS: "not measured" presented as a measurement. Each lock below encodes one link of it.
 */

const CLASSIFY_BASE = {
  hasFiles: true, liveBackend: true, everPublished: true, lastError: null, booting: false,
} as const;

describe('server: "not checked" is not "asleep"', () => {
  it('🔒 a current saved copy with no wantLive → the port is skipped and the status is NOT sleeping', () => {
    const plan = planPreviewHealthProbe({ liveBackend: true, hasCurrentCopy: true, wantLive: false });
    expect(plan).toEqual({ probePort: false, offerIdleCopy: true, standInAllowed: false });
    const h = classifyPreviewHealth({ ...CLASSIFY_BASE, livePortUp: null, portSkippedForSavedCopy: plan.offerIdleCopy });
    expect(h.status).not.toBe('sleeping');
    expect(h.status).toBe('idle_snapshot');
    expect(h.summary).not.toMatch(/takes over by itself|starting up/i);
  });

  it('🔒 wantLive → the port IS checked, no copy is offered, and an answering app is live', () => {
    const plan = planPreviewHealthProbe({ liveBackend: true, hasCurrentCopy: true, wantLive: true });
    expect(plan).toEqual({ probePort: true, offerIdleCopy: false, standInAllowed: true });
    const h = classifyPreviewHealth({ ...CLASSIFY_BASE, livePortUp: true, pageRendered: true, portSkippedForSavedCopy: plan.offerIdleCopy });
    expect(h.status).toBe('live');
  });

  it('wantLive with the port really down is honestly sleeping — then a heal is the right move', () => {
    const plan = planPreviewHealthProbe({ liveBackend: true, hasCurrentCopy: true, wantLive: true });
    const h = classifyPreviewHealth({ ...CLASSIFY_BASE, livePortUp: false, portSkippedForSavedCopy: plan.offerIdleCopy });
    expect(h.status).toBe('sleeping');
  });

  it('no copy at all → exactly the old behaviour: probe when a backend exists', () => {
    expect(planPreviewHealthProbe({ liveBackend: true, hasCurrentCopy: false, wantLive: false }).probePort).toBe(true);
    expect(planPreviewHealthProbe({ liveBackend: false, hasCurrentCopy: false, wantLive: true }).probePort).toBe(false);
  });

  it('a real crash still outranks the saved copy', () => {
    const h = classifyPreviewHealth({ ...CLASSIFY_BASE, livePortUp: null, lastError: 'EADDRINUSE', portSkippedForSavedCopy: true });
    expect(h.status).toBe('crashed');
  });

  it('the server never auto-reboots idle_snapshot, and every AI is told the real state', () => {
    const h = classifyPreviewHealth({ ...CLASSIFY_BASE, livePortUp: null, portSkippedForSavedCopy: true });
    expect(serverShouldReboot(h, 0, 5, Infinity, 0)).toBe(false);
    expect(previewHealthContextLine(h)).toContain('SAVED COPY');
  });
});

describe('watchdog: a healthy app is never rebooted', () => {
  const base = {
    autoResume: true, liveTabShown: true, hasUrl: true, liveBackend: true, diagnosing: false,
    streak: 0, total: 0, msSinceLastAttempt: Infinity,
  };
  it('🔒 idle_snapshot is HEALTHY — no reboot loop over a finished app', () => {
    expect(shouldAutoRebootPreview({ ...base, healthStatus: 'idle_snapshot' })).toBe(false);
    expect(shouldAutoRebootPreview({ ...base, healthStatus: 'sleeping' })).toBe(true); // control
  });
  it('and the one-shot restore does not fire for it either', () => {
    expect(shouldRestorePreview({ hasUrl: true, healthStatus: 'idle_snapshot', diagnosing: false })).toBe(false);
  });
});

describe('client: after a wake, the live app takes the frame', () => {
  const snap = 'https://copy.example.web.app/';
  const door = 'https://app.example/api/agentv3/preview-door?t=1';
  it('🔒 liveWanted → the live address, never the copy', () => {
    expect(chooseLiveFrameSrc({ snapshotUrl: snap, doorHref: door, effectiveUrl: 'https://5173-x.e2b.app', liveWanted: true }))
      .toEqual({ src: door, isSnapshot: false });
    expect(chooseLiveFrameSrc({ snapshotUrl: snap, doorHref: '', effectiveUrl: 'https://5173-x.e2b.app', liveWanted: true }))
      .toEqual({ src: 'https://5173-x.e2b.app', isSnapshot: false });
  });
  it('without the ask the copy still leads (the billing saving is kept)', () => {
    expect(chooseLiveFrameSrc({ snapshotUrl: snap, doorHref: door, effectiveUrl: 'u', liveWanted: false }))
      .toEqual({ src: snap, isSnapshot: true });
  });
  it('liveWanted with no live address falls back to the copy rather than a blank frame', () => {
    expect(chooseLiveFrameSrc({ snapshotUrl: snap, doorHref: '', effectiveUrl: '', liveWanted: true }))
      .toEqual({ src: snap, isSnapshot: true });
  });
  it('the framed copy is withdrawn while live is wanted', () => {
    expect(framedSnapshotUrl(snap, true)).toBe('');
    expect(framedSnapshotUrl(snap, false)).toBe(snap);
  });
});

describe('client: a failed wake says so plainly', () => {
  const waking = 'Showing your saved copy while the live preview starts up. … the live version takes over by itself the moment it is ready.';
  it('one failure keeps the server note; repeated failures stop promising "by itself"', () => {
    expect(snapshotNoteAfterWakeFailures(waking, 1)).toBe(waking);
    expect(snapshotNoteAfterWakeFailures(waking, WAKE_FAILURES_BEFORE_PLAIN_NOTE)).toBe(WAKE_GAVE_UP_NOTE);
    expect(WAKE_GAVE_UP_NOTE).not.toMatch(/by itself/);
  });
  it('the Wake up banner stays after a failure, and its wording turns plain', () => {
    expect(wakeBannerCopy('sleeping', 0)?.title).toBe('Preview is in sleep mode.');
    expect(wakeBannerCopy('idle_snapshot', 0)).not.toBeNull();
    expect(wakeBannerCopy('idle_snapshot', 2)?.title).toBe(WAKE_GAVE_UP_NOTE);
    expect(wakeBannerCopy('live', 5)).toBeNull();
  });
});

describe('wiring — the rules are the ones the code runs', () => {
  const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  it('the health route decides via planPreviewHealthProbe and passes portSkippedForSavedCopy', () => {
    expect(route).toContain("wantLive: req.body?.wantLive === true");
    expect(route).toContain('if (probePlan.probePort) {');
    expect(route).toContain('livePortUp !== true && probePlan.standInAllowed');
    expect(route).toContain('portSkippedForSavedCopy: probePlan.offerIdleCopy');
  });
  it('a successful wake clears the copy and remembers the ask; the poll sends wantLive', () => {
    const at = surface.indexOf("if (data?.ok && typeof data?.previewUrl === 'string' && data.previewUrl) {");
    const branch = surface.slice(at, at + 1600);
    expect(branch).toContain("setIdleSnapshotUrl('')");
    expect(branch).toContain('setLiveWantedFor(workspaceId)');
    expect(surface).toContain('wantLive: !!workspaceId && liveWantedRef.current === workspaceId');
    expect(surface).toContain('chooseLiveFrameSrc({ snapshotUrl: shownSnapshotUrl');
  });
  it('the ask ends with a new build and with the workspace', () => {
    expect(surface).toContain("if (buildPhase && buildPhase !== 'idle') setLiveWantedFor(null);");
    expect(surface).toContain('setLiveWantedFor(null); setWakeFailures(0);');
  });
});
