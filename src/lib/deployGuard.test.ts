import { describe, it, expect } from 'vitest';
import { deployBlockedReason, canDeploy } from './deployGuard';

// ROOT CAUSE (admin 2026-08-02, Publish modal on a phone): every Publish button called deployLive(),
// whose first line silently returned when `running || !workspaceId`. The modal closed itself first, so
// the user saw the sheet vanish and nothing happen — "iske sabhi button farzi hai". The precondition is
// now a REPORTED value the UI must show. These lock that contract.
describe('deployBlockedReason — a publish never fails silently', () => {
  it('allows a publish when everything is ready (null = go)', () => {
    expect(deployBlockedReason({ running: false, workspaceId: 'agentv3-u-1', providerConfigured: true })).toBeNull();
    expect(canDeploy({ running: false, workspaceId: 'agentv3-u-1', providerConfigured: true })).toBe(true);
  });

  it('explains the no-app case instead of doing nothing (the exact silent-return branch)', () => {
    const r = deployBlockedReason({ running: false, workspaceId: undefined });
    expect(r).toBeTruthy();
    expect(r).toMatch(/build an app first/i);
    expect(canDeploy({ running: false, workspaceId: undefined })).toBe(false);
    // an empty-string workspace is just as absent as undefined
    expect(deployBlockedReason({ running: false, workspaceId: '' })).toMatch(/build an app first/i);
    expect(deployBlockedReason({ running: false, workspaceId: null })).toMatch(/build an app first/i);
  });

  it('explains the build-already-running case (the other silent-return branch)', () => {
    const r = deployBlockedReason({ running: true, workspaceId: 'agentv3-u-1' });
    expect(r).toMatch(/already running/i);
    expect(r).toMatch(/wait/i); // actionable, not just a statement
  });

  it('names the unconfigured provider and where to fix it', () => {
    const r = deployBlockedReason({ running: false, workspaceId: 'w1', providerConfigured: false, providerName: 'Vercel' });
    expect(r).toContain('Vercel');
    expect(r).toContain('Settings → Secrets & Keys');
  });

  it('still answers when the provider name is unknown (no "undefined" in user text)', () => {
    const r = deployBlockedReason({ running: false, workspaceId: 'w1', providerConfigured: false });
    expect(r).toBeTruthy();
    expect(r).not.toMatch(/undefined|null/i);
  });

  it('checks preconditions in the most-useful order: no app beats a running build', () => {
    // Both wrong → the user needs the ROOT problem (no app), not "wait for the build".
    expect(deployBlockedReason({ running: true, workspaceId: undefined })).toMatch(/build an app first/i);
  });

  it('never leaks a vendor/internal name into the user-facing reason (white-label law)', () => {
    const reasons = [
      deployBlockedReason({ running: false, workspaceId: undefined }),
      deployBlockedReason({ running: true, workspaceId: 'w1' }),
      deployBlockedReason({ running: false, workspaceId: 'w1', providerConfigured: false, providerName: 'Vercel' }),
    ].join(' ').toLowerCase();
    for (const vendor of ['firebase', 'glm', 'kimi', 'claude', 'anthropic', 'gemini', 'e2b', 'openai']) {
      expect(reasons).not.toContain(vendor);
    }
  });

  it('treats providerConfigured=undefined as "not checked" (does not block)', () => {
    expect(deployBlockedReason({ running: false, workspaceId: 'w1' })).toBeNull();
  });
});
