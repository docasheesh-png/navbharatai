// failedbr #734, #735 (2026-11-20): AMBIENT_SHIM_REMOVED rewrote "Anthropic/claude-code/skills/plugin-authoring/reference/
// claude-code.d.ts" — a reference file in the user's imported repo that no build compiles — on every build.
import { describe, expect, it } from 'vitest';
import { findAmbientShimCollisions, inAppBuildScope } from '../src/server/AgentV3/ambientModuleShim';

const SHIM = "import { test } from '@playwright/test';\ndeclare module '@playwright/test' { export const devices: any; }\n";

describe('the shim repair stays inside the app (failedbr #734)', () => {
  it('a reference file outside the app is left alone', () => {
    expect(findAmbientShimCollisions({ 'Anthropic/claude-code/skills/plugin-authoring/reference/claude-code.d.ts': SHIM })).toEqual([]);
  });
  it('the app\'s own files are still repaired', () => {
    expect(findAmbientShimCollisions({ 'e2e/smoke.spec.ts': SHIM }).map((f) => f.path)).toEqual(['e2e/smoke.spec.ts']);
    expect(findAmbientShimCollisions({ 'playwright.config.ts': SHIM }).length).toBe(1);
  });
  it('scope', () => {
    expect(inAppBuildScope('src/a.ts')).toBe(true);
    expect(inAppBuildScope('vite.config.ts')).toBe(true);
    expect(inAppBuildScope('Cursor/prompts/x.ts')).toBe(false);
  });
});
