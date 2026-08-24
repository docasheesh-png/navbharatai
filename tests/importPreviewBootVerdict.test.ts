import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * "ITS VERDICT IS RECORDED HERE EVEN IF IT LANDS AFTER THE REPLY STREAM CLOSES."
 *
 * That sentence is in the message the engine writes when it starts a background live-preview boot —
 * and the admin's own build report (2026-08-24) had NEITHER a success nor a failure entry for it. Not a
 * bad verdict: no verdict at all, which reads exactly like "we never tried".
 *
 * ROOT CAUSE. The idle sweep measures inactivity from the last SANDBOX OPERATION, and
 * `npm install && npm run dev` is ONE long command — it stamps activity when it starts and then goes
 * quiet for minutes. The build that launched it has already released its own hold, so the sweep pauses
 * the machine mid-install, the awaiting promise never resolves, and neither branch runs.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

const boot = route.slice(
  route.indexOf('importPreviewBoot = (async () => {'),
  route.indexOf("})();", route.indexOf('importPreviewBoot = (async () => {')) + 6,
);

describe('the boot holds the machine open while it runs', () => {
  it('takes the hold before doing anything', () => {
    // Anchored on the first await rather than the first `try {` — the hold is ITSELF wrapped in a
    // try/catch, so `try {` appears before it and made the original comparison meaningless.
    expect(boot).toContain('actuator.setBuildActive?.(workspaceId, true)');
    expect(boot.indexOf('setBuildActive?.(workspaceId, true)')).toBeLessThan(boot.indexOf('await '));
  });

  it('releases it in a finally — a crash must never leave a workspace pinned', () => {
    const release = boot.indexOf('setBuildActive?.(workspaceId, false)');
    const fin = boot.indexOf('} finally {');
    expect(fin).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(fin);
  });

  it('uses the mechanism that already exists, not a second one', () => {
    // A background boot is as much "work in flight" as a build is, and the sweep already knows how to
    // skip work in flight. A private second flag would be a second thing to keep in step.
    expect(boot).not.toMatch(/setPreviewBootActive|bootInFlightMap/);
  });
});

describe('silence is not a verdict', () => {
  it('records CUT_OFF when neither branch reached one', () => {
    expect(boot).toContain("code: 'IMPORT_PREVIEW_BOOT_CUT_OFF'");
  });

  it('calls it UNKNOWN, not failed — being cut off says nothing about the app', () => {
    const i = boot.indexOf("IMPORT_PREVIEW_BOOT_CUT_OFF");
    const block = boot.slice(i, i + 500);
    expect(block).toContain('UNKNOWN');
    expect(block).toContain('not failed');
  });

  it('the flag is set at the branch POINT, so a new branch cannot be misreported as cut off', () => {
    const set = boot.indexOf('bootVerdictRecorded = true');
    const successEmit = boot.indexOf("emitLive({ type: 'preview', url: bootUrl");
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(successEmit);
  });

  it('and it still fires on both explicit failure paths', () => {
    expect((boot.match(/bootVerdictRecorded = true/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
