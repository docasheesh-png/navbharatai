import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canServeFromSnapshot } from '../src/server/AgentV3/snapshotServeDecision';

/**
 * THE BIGGEST REMAINING E2B LEVER, wired.
 *
 * Measured over 30 days: 1,257 sandboxes billed 1,498 vCPU-hours — 1.19 hours EACH, for builds that
 * take 3-18 minutes. The idle sweep pauses an unused sandbox in five minutes and almost never gets to,
 * because the health probe runs a command INSIDE the sandbox every 150s and any sandbox command resets
 * the idle clock. An open preview tab bills for as long as it is open.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

describe('the probe stands down when the saved copy can answer', () => {
  it('the sandbox probe is SKIPPED — that skip is the entire saving', () => {
    // If the probe still ran, nothing would change: the command would reset the idle clock exactly as
    // before and the sweep would still never win.
    expect(route).toContain('if (diag.livePreviewAvailable && !idleServe) {');
  });

  it('the decision is the shared pure rule, and it is asked BEFORE the probe', () => {
    const decide = route.indexOf('canServeFromSnapshot({');
    const probe = route.indexOf('if (diag.livePreviewAvailable && !idleServe) {');
    expect(decide).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(probe);
  });

  it('a running build is asked about by WORKSPACE, not globally', () => {
    // A global "is any build running" would stand the probe down on one user's idle app because a
    // different user was building — and, worse, keep it up on this one for the same reason.
    expect(route).toContain('buildRunning: isBuildRunningFor(workspaceId)');
    expect(route).toContain('function isBuildRunningFor(workspaceId: string | null | undefined): boolean');
  });

  it('honours the same kill switch as the snapshot itself', () => {
    const i = route.indexOf('const idleServe = await');
    expect(route.slice(i, i + 400)).toContain('previewSnapshotEnabled()');
  });
});

describe('the client frames the copy and says so', () => {
  it('prefers the saved copy over the door while the machine sleeps', () => {
    expect(surface).toContain('src={idleSnapshotUrl || (doorUrl ?');
  });

  it('accepts only an http(s) url from the server', () => {
    expect(surface).toContain("/^https?:\\/\\//i.test(health.idleSnapshotUrl)");
  });

  it('shows the note, and never both notes at once', () => {
    // `snapshotServing` means the machine is GONE; this means it is alive and deliberately asleep.
    // Two banners saying different things about the same app is worse than either alone.
    expect(surface).toContain('{!snapshotNote && idleSnapshotNote && (');
  });

  it('resets per workspace, like every other per-workspace signal', () => {
    expect(surface).toContain("setIdleSnapshotUrl(''); setIdleSnapshotNote('');");
  });
});

describe('the guarantee, executed rather than grepped', () => {
  it('a finished, unchanged, recent app qualifies — and a running build never does', () => {
    const now = 1_787_600_000_000;
    const base = { snapshotUrl: 'https://x.web.app', snapshotAt: now - 60_000, now };
    expect(canServeFromSnapshot({ ...base, buildRunning: false })).toBe(true);
    expect(canServeFromSnapshot({ ...base, buildRunning: true })).toBe(false);
  });
});
