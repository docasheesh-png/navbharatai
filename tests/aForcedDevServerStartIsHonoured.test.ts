// failedbr #1043, #1022 (2026-11-20): Vite served an empty transform of game.tsx ("does not provide an export named
// 'BlockWorldGame'", tsc and the production build clean), and the model's `vite --force` — seven times — was answered
// "[health-check] dev server already healthy … reused it (no relaunch)". The one restart the guard leaves the model was
// swallowed for 12 minutes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { devCommandForcesRestart, shouldSkipDevServerLaunch } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

describe('a forced dev-server start is honoured (failedbr #1043)', () => {
  it('--force asks for a fresh start; a plain start does not', () => {
    expect(devCommandForcesRestart('npx vite --force')).toBe(true);
    expect(devCommandForcesRestart('npm run dev -- --force')).toBe(true);
    expect(devCommandForcesRestart('npm run dev')).toBe(false);
    expect(devCommandForcesRestart('npx vite --port 5174')).toBe(false);
  });
  it('a healthy server is reused unless the start was forced', () => {
    expect(shouldSkipDevServerLaunch(true, false, false, false)).toBe(true);
    expect(shouldSkipDevServerLaunch(true, false, false, true)).toBe(false);
  });
  it('🔒 the sandbox fast path asks the command', () => {
    expect(readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8'))
      .toContain('shouldSkipDevServerLaunch(alreadyUp, stale, prebundleStale, devCommandForcesRestart(command))');
  });
});
