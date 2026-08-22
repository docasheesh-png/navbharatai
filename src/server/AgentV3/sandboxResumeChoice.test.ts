import { describe, it, expect } from 'vitest';
import { resumeSandboxChoice } from './sandboxResumeChoice';

/**
 * ADMIN, 2026-08-22 — E2B's own page:
 *
 *   "The sandbox i5ougia1mw2kcj39ualmm is running but there's no service running on port 3000."
 *
 * The actuator tracked live sandboxes in an IN-MEMORY map belonging to ONE server instance — empty
 * after every deploy, every recycle, and on every other instance behind the load balancer. The
 * workspace's real sandbox id was durable the whole time, and only the wake route ever read it.
 *
 * Two failures fell out of that: the preview health probe gates on `getSandboxId`, so on a cold
 * instance it never ran, the app was never classified as stopped, the auto-restore never fired, and
 * the iframe just loaded the stale URL — E2B's closed-port page, identically on every reload. And,
 * silently, any command on a cold instance fell through to creating a brand-new EMPTY sandbox.
 */
describe('resumeSandboxChoice', () => {
  it('THE CASE THAT STARTED THIS: a cold instance reconnects instead of creating an empty machine', () => {
    expect(resumeSandboxChoice({ durable: 'i5ougia1mw2kcj39ualmm', resumeEnabled: true }))
      .toBe('i5ougia1mw2kcj39ualmm');
  });

  it('🔒 an EXPLICIT id always wins — that caller knows something we do not', () => {
    // The wake route resolves a specific sandbox itself; second-guessing it would break that path.
    expect(resumeSandboxChoice({ explicit: 'chosen', durable: 'other', resumeEnabled: true })).toBe('chosen');
  });

  it('🔒 the kill switch stops us reaching for one on our OWN initiative, but never sabotages a caller', () => {
    // A "safe" flag that also disabled an explicitly-passed id would be the thing that breaks the
    // working path — the exact shape of a safety measure causing the outage.
    expect(resumeSandboxChoice({ durable: 'stored', resumeEnabled: false })).toBeUndefined();
    expect(resumeSandboxChoice({ explicit: 'chosen', durable: 'stored', resumeEnabled: false })).toBe('chosen');
  });

  it('nothing recorded ⇒ undefined, so a first-ever build still creates a fresh sandbox', () => {
    expect(resumeSandboxChoice({ resumeEnabled: true })).toBeUndefined();
    expect(resumeSandboxChoice({ durable: null, resumeEnabled: true })).toBeUndefined();
  });

  it('blank and whitespace ids are not ids', () => {
    // A '' from a partially-written record must not become `Sandbox.connect('')`.
    expect(resumeSandboxChoice({ durable: '   ', resumeEnabled: true })).toBeUndefined();
    expect(resumeSandboxChoice({ explicit: '', durable: 'stored', resumeEnabled: true })).toBe('stored');
  });

  it('trims, so a stray newline in a stored id cannot break the connect', () => {
    expect(resumeSandboxChoice({ durable: ' sb-1\n', resumeEnabled: true })).toBe('sb-1');
  });
});
