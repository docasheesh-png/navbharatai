import { describe, it, expect } from 'vitest';
import {
  shouldAutoRebootPreview, type AutoRebootSignals,
  AUTO_HEAL_COOLDOWN_MS, AUTO_HEAL_MAX_STREAK, AUTO_HEAL_MAX_TOTAL,
  shouldRestorePreview,
} from './previewAutoReboot';

const base: AutoRebootSignals = {
  autoResume: true,
  liveTabShown: true,
  hasUrl: true,
  liveBackend: true,
  diagnosing: false,
  streak: 0,
  total: 0,
  msSinceLastAttempt: Infinity,
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

  it('respects every gate: idle-only, Live tab only, URL present, backend present, no overlap', () => {
    expect(shouldAutoRebootPreview({ ...base, autoResume: false })).toBe(false);      // mid-build
    expect(shouldAutoRebootPreview({ ...base, liveTabShown: false })).toBe(false);    // in-browser tab
    expect(shouldAutoRebootPreview({ ...base, hasUrl: false })).toBe(false);          // C1 auto-resume owns no-URL
    expect(shouldAutoRebootPreview({ ...base, liveBackend: false })).toBe(false);     // nothing to boot
    expect(shouldAutoRebootPreview({ ...base, diagnosing: true })).toBe(false);       // already in flight
  });
});

// V2 (admin 2026-08-03, "preview chal jane ke baad gayab na ho"): once-per-workspace healed only the
// FIRST death — a tab open past the next idle-pause stayed dead forever. The policy is now cooldown +
// bounded attempts: repeat deaths heal, a boot-crash-boot hammer stays impossible.
describe('shouldAutoRebootPreview V2 — repeat deaths heal; hammering stays impossible', () => {
  it('a SECOND death (successful heal reset the streak, cooldown passed) heals again — the old latch could not', () => {
    expect(shouldAutoRebootPreview({ ...base, streak: 0, total: 1, msSinceLastAttempt: AUTO_HEAL_COOLDOWN_MS + 1 })).toBe(true);
  });

  it('the cooldown blocks a re-heal fired too soon after the last attempt', () => {
    expect(shouldAutoRebootPreview({ ...base, total: 1, msSinceLastAttempt: AUTO_HEAL_COOLDOWN_MS - 1 })).toBe(false);
    expect(shouldAutoRebootPreview({ ...base, total: 1, msSinceLastAttempt: AUTO_HEAL_COOLDOWN_MS })).toBe(true);
  });

  it('the first-ever heal is instant (Infinity since last attempt passes the cooldown)', () => {
    expect(shouldAutoRebootPreview({ ...base, msSinceLastAttempt: Infinity })).toBe(true);
  });

  it('a streak of consecutive FAILED heals stops the hammering', () => {
    expect(shouldAutoRebootPreview({ ...base, streak: AUTO_HEAL_MAX_STREAK, total: AUTO_HEAL_MAX_STREAK, msSinceLastAttempt: Infinity })).toBe(false);
    expect(shouldAutoRebootPreview({ ...base, streak: AUTO_HEAL_MAX_STREAK - 1, total: AUTO_HEAL_MAX_STREAK - 1, msSinceLastAttempt: AUTO_HEAL_COOLDOWN_MS })).toBe(true);
  });

  it('the absolute per-mount total cap holds even when every heal succeeded (streak keeps resetting)', () => {
    expect(shouldAutoRebootPreview({ ...base, streak: 0, total: AUTO_HEAL_MAX_TOTAL, msSinceLastAttempt: AUTO_HEAL_COOLDOWN_MS * 10 })).toBe(false);
  });
});

// THE RETURNING USER (admin 2026-08-21: "live preview ek bar chal jata hai… kuch der baad band kar ke
// wapas ao to yeh chalta hi nahi hai").
//
// A sandbox is PAUSED after it sits idle — on purpose, because it is billed by running time. The user
// who comes back is holding the URL from before that pause. The old restore bailed whenever a URL
// existed, so it never once fired for the case it was written for.
describe('shouldRestorePreview — a stale URL is not a live preview', () => {
  it('RESTORES when the user returns to a slept preview, even though they still hold its URL', () => {
    expect(shouldRestorePreview({ hasUrl: true, healthStatus: 'sleeping', diagnosing: false })).toBe(true);
  });

  it('restores a crashed preview too — same silence from the user\'s side', () => {
    expect(shouldRestorePreview({ hasUrl: true, healthStatus: 'crashed', diagnosing: false })).toBe(true);
  });

  it('restores when there is no URL at all — the case that always worked', () => {
    expect(shouldRestorePreview({ hasUrl: false, healthStatus: null, diagnosing: false })).toBe(true);
  });

  it('leaves a HEALTHY preview alone — never reboots something that is working', () => {
    for (const status of ['live', 'booting']) {
      expect(shouldRestorePreview({ hasUrl: true, healthStatus: status, diagnosing: false })).toBe(false);
    }
  });

  it('does NOT act on an unknown health — a URL plus no verdict is not evidence of death', () => {
    // Rebooting on a guess would spin up a billed sandbox for a preview that may be perfectly fine.
    expect(shouldRestorePreview({ hasUrl: true, healthStatus: null, diagnosing: false })).toBe(false);
    expect(shouldRestorePreview({ hasUrl: true, healthStatus: 'not_serving', diagnosing: false })).toBe(false);
  });

  it('never starts a second restore while one is already running', () => {
    expect(shouldRestorePreview({ hasUrl: false, healthStatus: 'sleeping', diagnosing: true })).toBe(false);
    expect(shouldRestorePreview({ hasUrl: true, healthStatus: 'sleeping', diagnosing: true })).toBe(false);
  });
});
