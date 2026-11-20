// failedbr #1617 and #1620 (2026-11-20).
// #1617: `. ./node_modules/.bin/tsc --noEmit` ran seven times; `.` sources the file AS SHELL, so tsc's `import` lines ran
// ImageMagick's `import` ("unable to open X server") and the compiler never ran.
// #1620: "Muje free fire app ke lia panel app bana kar do" (a panel app FOR Free Fire) was "LARGE — clone of Free Fire".
import { describe, expect, it } from 'vitest';
import { fixNodeModulesTypo } from '../src/server/AgentV3/nodeModulesTypo';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';

describe('a sourced package binary is run, not sourced (failedbr #1617)', () => {
  it.each([
    ['. ./node_modules/.bin/tsc --noEmit', './node_modules/.bin/tsc --noEmit'],
    ['source ./node_modules/.bin/vite --host', './node_modules/.bin/vite --host'],
    ['cd /home/user/workspace && . node_modules/.bin/tsc', 'cd /home/user/workspace && ./node_modules/.bin/tsc'],
  ])('%s', (input, out) => {
    expect(fixNodeModulesTypo(input)).toEqual({ command: out, fixed: true });
  });
  it('a sourced env file or script is left alone', () => {
    expect(fixNodeModulesTypo('. ./scripts/env.sh && npm run dev').fixed).toBe(false);
    expect(fixNodeModulesTypo('source venv/bin/activate').fixed).toBe(false);
  });
});

describe('"X ke liye" is "for X", not a clone of X (failedbr #1620)', () => {
  it.each(['Muje free fire app ke lia panel app bana kar do', 'free fire ke liye tournament app banao', 'instagram ke liye caption generator'])(
    'no clone: %s', (p) => {
      expect(analyzeAppScope(p).famousApp).toBeNull();
    });
  it.each(['Free Fire jaisa game banao', 'Build a Free Fire clone'])('still a clone: %s', (p) => {
    expect(analyzeAppScope(p).famousApp).not.toBeNull();
  });
});
