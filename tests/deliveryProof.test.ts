import { describe, it, expect } from 'vitest';
import {
  shouldAttemptPlatformPreview, platformPreviewBudgetMs, platformPreviewPort,
  PLATFORM_PREVIEW_MIN_REMAINING_MS, PLATFORM_PREVIEW_MAX_BUDGET_MS,
} from '../src/server/AgentV3/deliveryProof';

/**
 * DELIVERY PROOF (autopsy 4efab9d7, 2026-09-15): "app bani = preview chala". Every runtime proof in
 * the engine is gated on a preview URL that only the AGENT used to publish. These pin the decision
 * that lets the platform publish one itself, and the bounds that keep it from becoming a new stall.
 */
const base = {
  expectsArtifacts: true, hasPreviewUrl: false, aborted: false, isImportTurn: false,
  appFiles: 16, hasPackageJson: true, remainingMs: 20 * 60_000, env: {} as NodeJS.ProcessEnv,
};

describe('shouldAttemptPlatformPreview', () => {
  it('🔴 the 4efab9d7 shape — files present, no URL ever published, budget left — ATTEMPTS', () => {
    expect(shouldAttemptPlatformPreview(base).attempt).toBe(true);
  });

  it('stands down when the agent already published a preview', () => {
    expect(shouldAttemptPlatformPreview({ ...base, hasPreviewUrl: true })).toMatchObject({ attempt: false, reason: expect.stringMatching(/already published/) });
  });

  it('never runs a server for a turn that was not meant to build, an import, or an aborted build', () => {
    expect(shouldAttemptPlatformPreview({ ...base, expectsArtifacts: false }).attempt).toBe(false);
    expect(shouldAttemptPlatformPreview({ ...base, isImportTurn: true }).attempt).toBe(false);
    expect(shouldAttemptPlatformPreview({ ...base, aborted: true }).attempt).toBe(false);
  });

  it('needs an app to start — files, and a package.json to run', () => {
    expect(shouldAttemptPlatformPreview({ ...base, appFiles: 0 }).attempt).toBe(false);
    expect(shouldAttemptPlatformPreview({ ...base, hasPackageJson: false }).attempt).toBe(false);
  });

  it('respects the wall clock — too little budget left is a named reason, not a silent skip', () => {
    const d = shouldAttemptPlatformPreview({ ...base, remainingMs: PLATFORM_PREVIEW_MIN_REMAINING_MS - 1 });
    expect(d.attempt).toBe(false);
    expect(d.reason).toMatch(/budget left/);
    expect(shouldAttemptPlatformPreview({ ...base, remainingMs: null }).attempt).toBe(true); // uncapped
  });

  it('has a kill switch, project convention', () => {
    expect(shouldAttemptPlatformPreview({ ...base, env: { AGENTV3_PLATFORM_PREVIEW: 'off' } }).attempt).toBe(false);
    expect(shouldAttemptPlatformPreview({ ...base, env: { AGENTV3_PLATFORM_PREVIEW: 'on' } }).attempt).toBe(true);
  });

  it('every refusal names its reason', () => {
    for (const v of [{ hasPreviewUrl: true }, { aborted: true }, { isImportTurn: true }, { expectsArtifacts: false }, { appFiles: 0 }, { hasPackageJson: false }, { remainingMs: 1000 }]) {
      const d = shouldAttemptPlatformPreview({ ...base, ...v });
      expect(d.attempt).toBe(false);
      expect(d.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('platformPreviewBudgetMs — bounded, and never past the wall-clock margin', () => {
  it('caps the ten-minute wake budget at four minutes', () => {
    expect(platformPreviewBudgetMs(null, 10 * 60_000)).toBe(PLATFORM_PREVIEW_MAX_BUDGET_MS);
  });
  it('leaves the verify pass room before the cap', () => {
    expect(platformPreviewBudgetMs(5 * 60_000, 10 * 60_000)).toBe(3 * 60_000);
  });
  it('never goes below 30s and never trusts a junk wake budget', () => {
    expect(platformPreviewBudgetMs(60_000, 10 * 60_000)).toBe(30_000);
    expect(platformPreviewBudgetMs(null, NaN)).toBe(PLATFORM_PREVIEW_MAX_BUDGET_MS);
  });
});

describe('platformPreviewPort — a port we SAW serving beats one the app declares beats the default', () => {
  it('orders the three sources', () => {
    expect(platformPreviewPort(3000, 5173, 5173)).toBe(3000);
    expect(platformPreviewPort(null, 4000, 5173)).toBe(4000);
    expect(platformPreviewPort(undefined, undefined, 5173)).toBe(5173);
  });
  it('ignores junk', () => {
    expect(platformPreviewPort(0, -1, 5173)).toBe(5173);
    expect(platformPreviewPort(70000, NaN, 5173)).toBe(5173);
  });
});
