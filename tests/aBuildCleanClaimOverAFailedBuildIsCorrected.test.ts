/**
 * "GAME BUILD CLEAN HAI" OVER A FAILED PRODUCTION BUILD IS CORRECTED (build report #2526, 2026-11-25).
 *
 * The closing summary said: "✅ Gun wala feature ban gaya — aur usko banate waqt mile 4 purane TypeScript error bhi theek kar
 * diye (game build clean hai)." In the SAME report, PROD_BUILD_FAILED quoted openWorld.ts TS2352 and worldLayer.ts TS2322 —
 * errors that fail Publish and the APK. The claim audit had no fact for the production build and no pattern for "build
 * clean" (only "type-check passes" over a typecheck that never ran). The class: a build-health claim over a build that
 * measurably failed. The route now hands the audit `prodBuildFailed`, and the audit reads the builder's own words.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';

const SAID = '✅ Gun wala feature ban gaya — aur usko banate waqt mile 4 purane TypeScript error bhi theek kar diye (game build clean hai).';
const kinds = (text: string, failed: boolean | undefined) => auditSummaryClaims(text, { prodBuildFailed: failed }).map((c) => c.kind);

describe('🔴 the #2526 sentence', () => {
  it('is contradicted when the production build failed', () => {
    expect(kinds(SAID, true)).toContain('build-clean-but-failed');
  });
  it('stands when the build passed, or nobody measured it', () => {
    expect(kinds(SAID, false)).not.toContain('build-clean-but-failed');
    expect(kinds(SAID, undefined)).not.toContain('build-clean-but-failed');
  });
  it('the other ways a builder says it', () => {
    for (const s of ['The production build passes.', 'Build is clean now.', 'It builds successfully.', 'No TypeScript errors left.', 'TypeScript type-check passes cleanly.', 'koi errors nahi bacha']) {
      expect(kinds(s, true), s).toContain('build-clean-but-failed');
    }
  });
  it('an honest sentence is never accused', () => {
    for (const s of ['The production build still fails on two TypeScript errors.', 'I added a gun.', 'Build the city next.']) {
      expect(kinds(s, true), s).not.toContain('build-clean-but-failed');
    }
  });
  it('🔒 the route passes the production build\'s outcome', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("prodBuildFailed: prodBuildOutcome === 'failed',");
  });
});
