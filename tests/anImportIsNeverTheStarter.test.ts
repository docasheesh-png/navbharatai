// Build d62bf22d (2026-10-17): a GitHub import (Mitrify) landed in a workspace our 11-file starter had
// been seeded into first, and RENDERED_ONLY_THE_STARTER fired on the user's running app.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldSeedStarter } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/seedStarter';
import { importNeverTheStarter } from '../src/server/AgentV3/stillTheStarterApp';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const e2b = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');

describe('an imported project never gets, and is never judged as, our starter', () => {
  it("an 'import' workspace, or one told not to, is not seeded", () => {
    expect(shouldSeedStarter('import')).toBe(false);
    expect(shouldSeedStarter('vite-react', { seedStarter: false })).toBe(false);
    expect(shouldSeedStarter('import', { seedStarter: true })).toBe(false);
  });

  it('every other workspace is seeded exactly as before', () => {
    expect(shouldSeedStarter(undefined)).toBe(true);
    expect(shouldSeedStarter('vite-react')).toBe(true);
    expect(shouldSeedStarter('nextjs', {})).toBe(true);
  });

  it('the E2B setup returns before the template write when it must not seed, and skips the fragment completion', () => {
    const attempt = e2b.slice(e2b.indexOf('private async _ensureWorkspaceAttempt'));
    const guard = attempt.indexOf('if (!seedStarter) {');
    const write = attempt.indexOf("files.writeFiles(template)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(write);
    expect(attempt).toContain('if (seedStarter) await this._completeStarterFragment(');
  });

  it('the build turn asks for no starter when the request imports a project', () => {
    expect(route).toContain('await actuator.ensureWorkspace(workspaceId, framework, resumeSandboxId, hasImportIntent ? { seedStarter: false } : undefined);');
  });

  it('on an import turn neither starter check can call the app the starter', () => {
    expect(importNeverTheStarter(true)).toBe(true);
    expect(importNeverTheStarter(false)).toBe(false);
    expect(route).toMatch(/const renderIsOnlyTheStarter = \(\): Promise<boolean> => importNeverTheStarter\(isImportTurn\) \? Promise\.resolve\(false\)/);
    const shown = route.slice(route.indexOf('const starterShownOn = async'));
    expect(shown.slice(0, 200)).toContain('if (importNeverTheStarter(isImportTurn)) return null;');
  });
});
