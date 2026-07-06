import { describe, it, expect } from 'vitest';
import { shouldAutoRebootPreview, type AutoRebootSignals } from './previewAutoReboot';

const base: AutoRebootSignals = {
  autoResume: true,
  liveTabShown: true,
  hasUrl: true,
  liveBackend: true,
  diagnosing: false,
  alreadyRebooted: false,
  healthStatus: 'sleeping',
};

describe('shouldAutoRebootPreview — a dead live preview behind an existing URL self-heals', () => {
  it('the exact reported case: URL remembered, sandbox idle-killed the dev server → reboot', () => {
    // 2026-07-07: hours after a successful build the Live tab showed "Closed Port Error" — the URL
    // existed but the server behind it was dead, and nothing auto-healed. sleeping/crashed → reboot.
    expect(shouldAutoRebootPreview({ ...base, healthStatus: 'sleeping' })).toBe(true);
    expect(shouldAutoRebootPreview({ ...base, healthStatus: 'crashed' })).toBe(true);
  });

  it('never reboots a healthy or already-starting preview', () => {
    expect(shouldAutoRebootPreview({ ...base, healthStatus: 'live' })).toBe(false);
    expect(shouldAutoRebootPreview({ ...base, healthStatus: 'booting' })).toBe(false);
  });

  it('never reboots when there is nothing to boot (no files / no live backend classification)', () => {
    expect(shouldAutoRebootPreview({ ...base, healthStatus: 'empty' })).toBe(false);
    expect(shouldAutoRebootPreview({ ...base, healthStatus: 'inbrowser_only' })).toBe(false);
  });

  it('never reboots on a failed probe (null) — no booting on a guess', () => {
    expect(shouldAutoRebootPreview({ ...base, healthStatus: null })).toBe(false);
  });

  it('respects every gate: idle-only, Live tab only, URL present, backend present, no overlap, once per workspace', () => {
    expect(shouldAutoRebootPreview({ ...base, autoResume: false })).toBe(false);      // mid-build
    expect(shouldAutoRebootPreview({ ...base, liveTabShown: false })).toBe(false);    // in-browser tab
    expect(shouldAutoRebootPreview({ ...base, hasUrl: false })).toBe(false);          // C1 auto-resume owns no-URL
    expect(shouldAutoRebootPreview({ ...base, liveBackend: false })).toBe(false);     // nothing to boot
    expect(shouldAutoRebootPreview({ ...base, diagnosing: true })).toBe(false);       // already in flight
    expect(shouldAutoRebootPreview({ ...base, alreadyRebooted: true })).toBe(false);  // loop guard
  });
});
