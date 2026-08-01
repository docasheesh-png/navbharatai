import { describe, it, expect } from 'vitest';
import { renderRescueEligible, renderRescueConfirmsSuccess } from '../src/server/AgentV3/renderRescue';

/**
 * Render rescue (admin 2026-07-30): a build that finished ok:false but actually WROTE the app and whose
 * live preview RENDERS cleanly must be upgraded to a success — so build-health, billing and the chat
 * verdict are honest (the exact bug: preview running, chat error, health 0, bill 0, admin ate the cost).
 */

describe('renderRescueEligible — only rescue a real, not-ok build with written files', () => {
  it('the reported bug case IS eligible: ok:false + expectsArtifacts + files written', () => {
    expect(renderRescueEligible({ ok: false, expectsArtifacts: true, filesWritten: 12 })).toBe(true);
  });

  it('an already-ok build is NOT rescued (nothing to fix)', () => {
    expect(renderRescueEligible({ ok: true, expectsArtifacts: true, filesWritten: 12 })).toBe(false);
  });

  it('a no-artifact turn (chat/import/survey) is NOT eligible even when not ok', () => {
    expect(renderRescueEligible({ ok: false, expectsArtifacts: false, filesWritten: 12 })).toBe(false);
  });

  it('a not-ok build that wrote NO files is NOT eligible (nothing was built)', () => {
    expect(renderRescueEligible({ ok: false, expectsArtifacts: true, filesWritten: 0 })).toBe(false);
  });
});

describe('renderRescueConfirmsSuccess — only upgrade when the app genuinely renders', () => {
  it('upgrades when the preview rendered and there are zero console errors', () => {
    expect(renderRescueConfirmsSuccess({ rendered: true, consoleErrorCount: 0 })).toBe(true);
  });

  it('does NOT upgrade a preview that did not render (no fake success)', () => {
    expect(renderRescueConfirmsSuccess({ rendered: false, consoleErrorCount: 0 })).toBe(false);
  });

  it('does NOT upgrade a rendered preview that still has runtime console errors', () => {
    expect(renderRescueConfirmsSuccess({ rendered: true, consoleErrorCount: 3 })).toBe(false);
  });

  // Real report 8a6e4585: a Rules-of-Hooks violation renders fine on first paint (rendered:true, zero
  // console errors at the snapshot) yet crashes on re-render — the admin saw the crash while the rescue
  // upgraded to "success". A deterministic runtime-crash proof must veto the rescue.
  it('does NOT upgrade when a deterministic runtime-crash blocker is present, even if it painted clean', () => {
    expect(renderRescueConfirmsSuccess({ rendered: true, consoleErrorCount: 0, runtimeCrashBlocker: true })).toBe(false);
  });

  it('still upgrades a clean render when there is no runtime-crash blocker (flag absent or false)', () => {
    expect(renderRescueConfirmsSuccess({ rendered: true, consoleErrorCount: 0, runtimeCrashBlocker: false })).toBe(true);
    expect(renderRescueConfirmsSuccess({ rendered: true, consoleErrorCount: 0 })).toBe(true);
  });
});
