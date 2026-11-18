// Q-2713 (autopsy 57604006, build 969740df, 2026-11-17): `tsc --noEmit 2>&1 > typecheck_output.txt` was adopted as a
// project file — "I changed 2 files in your project (src/game/battleroyale/game.ts, typecheck_output.txt)".
import { describe, expect, it } from 'vitest';
import { isScratchCapture } from '../src/server/AgentV3/scratchCapture';
import { collectWorkspaceFiles } from '../src/server/AgentV3/WorkspaceFiles';

const TSC = "src/game/battleroyale/game.ts(267,37): error TS2349: This expression is not callable.\n  Type 'Boolean' has no call signatures.\n";

describe('a captured tool output is scratch', () => {
  it("the build's own file, with the build's own content — and empty, as a clean rerun leaves it", () => {
    expect(isScratchCapture('typecheck_output.txt', TSC)).toBe(true);
    expect(isScratchCapture('./typecheck_output.txt', '')).toBe(true);
  });
  it('other captures the builder writes', () => {
    expect(isScratchCapture('lint.log', '✖ 3 problems (3 errors, 0 warnings)')).toBe(true);
    expect(isScratchCapture('test-results.txt', ' Test Files  2 passed (2)\n      Tests  9 passed (9)')).toBe(true);
    expect(isScratchCapture('build_output.txt', 'vite v6.2.0 building for production…\n✓ built in 6.3s')).toBe(true);
  });
  it("the user's own text files are their project, whatever they contain", () => {
    expect(isScratchCapture('notes.txt', '')).toBe(false);
    expect(isScratchCapture('CHANGELOG.txt', 'v1: first release')).toBe(false);
    expect(isScratchCapture('output.txt', 'The poem I wrote for the app')).toBe(false);
    expect(isScratchCapture('docs/typecheck_output.txt', TSC)).toBe(false); // only at the workspace root
    expect(isScratchCapture('src/errors.ts', TSC)).toBe(false);
  });
  it('the final collection leaves it out, and keeps the app', async () => {
    const tree: Record<string, string> = { 'package.json': '{}', 'src/main.ts': 'x', 'typecheck_output.txt': TSC, 'notes.txt': 'mine' };
    const source = { listFiles: async () => Object.keys(tree), readFile: async (_w: string, p: string) => tree[p] } as never;
    const out = await collectWorkspaceFiles(source, 'w');
    expect(Object.keys(out.files).sort()).toEqual(['notes.txt', 'package.json', 'src/main.ts']);
  });
});

describe('the shell-write ledger asks the same question (source guard)', () => {
  it('both read-back paths skip a capture before recording it as a project write', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/server/AgentV3/ToolDispatcher.ts', import.meta.url), 'utf8');
    expect(src.split("!isScratchCapture(path, content)) this.onFileWrite(path, content)").length - 1).toBe(2);
  });
});
