// 🔴 failedbr #2452 (6aed1d6e): four minutes, ~35 calls, nothing written, the user stopped it. The builder read through
// `bash` (`cd …; cat …; sed -n …; grep … | head`), so the exploration guard — which counted only read_file/grep/glob and
// called any turn with `bash` "not exploration" — never handed it back. The same report's gate called a failed read (the
// wrong folder, recovered 3 s later) a "build-breaking blocker". One conservative definition fixes both.
// Reversion: drop `toolCalls` from the guard, or `isReadOnlyInspection` from the failed-command test, and this fails.
import { describe, it, expect } from 'vitest';
import { isReadOnlyInspection } from '../src/server/AgentV3/shellInspection';
import { advanceExplorationProgress, initialExplorationProgress } from '../src/server/AgentV3/explorationProgress';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/** The report's own commands, verbatim where the report kept them. */
const REAL_READS = [
  'cd /home/user 2>/dev/null; cat src/App.tsx; echo "---TYPES---"; cat src/types.ts; echo "---GAMEHEAD---"; sed -n 1,80p src/game/Game.ts',
  'cd /home/user/workspace; echo "=== objects.ts exports ==="; grep -n "^export " src/game/three/objects.ts | head -120',
  'cd /home/user/workspace; sed -n 1,60p src/game/systems/weapon.ts; echo "--- Weapon class ---"; sed -n 59,170p src/game/systems/weapon.ts',
  'cd /home/user/workspace; for f in src/game/systems/*.ts; do echo "=== $f ==="; grep -n "^export" $f; done',
  'ls -la && echo "---PKG---" && cat package.json && echo "---SRC---" && ls -R src 2>/dev/null | head -60',
];

describe('isReadOnlyInspection', () => {
  it.each(REAL_READS)('reads: %s', (cmd) => { expect(isReadOnlyInspection(cmd)).toBe(true); });
  it.each([
    'cat a.ts > b.ts', 'sed -i "s/a/b/" src/App.tsx', 'npm run build', 'grep x a.ts; npm install', 'find . -name "*.log" -delete',
    'echo hi | tee out.txt', 'rm -rf dist', 'cat $(ls)', "python3 - <<'EOF'", 'curl -sL https://example.com', 'awk \'{print > "x"}\' a',
  ])('does NOT read-only: %s', (cmd) => { expect(isReadOnlyInspection(cmd)).toBe(false); });
  it('a pattern that contains a separator is not structure', () => {
    expect(isReadOnlyInspection('grep -n "rm -rf; npm" src/a.ts')).toBe(true);
  });
});

describe('the exploration guard counts bash reads', () => {
  it('eight turns of bash reads with no change ⇒ the builder is handed back', () => {
    let state = initialExplorationProgress(0);
    let steered = false;
    for (let t = 0; t < 8; t++) {
      const call = { name: 'bash', input: { command: REAL_READS[t % REAL_READS.length] } };
      const r = advanceExplorationProgress(state, { writingRun: true, changes: 0, toolNames: ['bash'], toolCalls: [call], editingExistingApp: true }, {} as NodeJS.ProcessEnv);
      state = r.state;
      steered = steered || !!r.steer;
    }
    expect(steered).toBe(true);
  });
  it('a bash command that builds or installs is still not exploration', () => {
    let state = initialExplorationProgress(0);
    for (let t = 0; t < 12; t++) {
      const r = advanceExplorationProgress(state, { writingRun: true, changes: 0, toolNames: ['bash'], toolCalls: [{ name: 'bash', input: { command: 'npm run build' } }], editingExistingApp: true }, {} as NodeJS.ProcessEnv);
      state = r.state;
      expect(r.steer).toBeNull();
    }
  });
});

describe('a failed read is not a build failure', () => {
  it('the #2452 wrong-folder read is recorded as a command, not SANDBOX_CMD_FAILED', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: REAL_READS[0], exitCode: 2, stderr: 'sed: can\'t read src/game/Game.ts: No such file or directory', durationMs: 50 });
    const codes = d.report().issues.map((i) => i.code);
    expect(codes).not.toContain('SANDBOX_CMD_FAILED');
    expect(codes).toContain('SANDBOX_CMD');
  });
  it('a failed build is still a failure', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm run build', exitCode: 1, stderr: 'error TS2304', durationMs: 50 });
    expect(d.report().issues.map((i) => i.code)).toContain('SANDBOX_CMD_FAILED');
  });
});
