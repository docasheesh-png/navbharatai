// 🔴 "Remix Vite plugin not found in Vite config" IS A RECOGNISABLE ERROR (failedbr #2208, 2026-11-20).
//
// The dev server printed exactly that, and the launcher restarted it twice as "the log had no recognisable error",
// then gave up; the 25-minute cap ended the build. A restart cannot add a plugin to vite.config.
// Reversion: drop `missingVitePlugin` from the configuration-error chain and the first test fails.

import { describe, it, expect } from 'vitest';
import { classifyDevServerFailure } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';

const REPORT_LOG = `> my-remix-app@1.0.0 dev
> remix vite:dev --host --host 0.0.0.0 --port 5173 --strictPort

The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
Remix Vite plugin not found in Vite config
`;

describe('a missing framework Vite plugin is a configuration error, not a restartable unknown', () => {
  it("the report's log", () => {
    const d = classifyDevServerFailure(REPORT_LOG);
    expect(d.cause).toBe('code_error');
    expect(d.detail).toMatch(/Remix Vite plugin not found in Vite config/);
  });
  it('React Router names the same failure the same way', () => {
    expect(classifyDevServerFailure('React Router Vite plugin not found in Vite config').cause).toBe('code_error');
  });
  it('an unrelated quiet log is still unknown', () => {
    expect(classifyDevServerFailure('starting…\n').cause).toBe('unknown');
  });
});
