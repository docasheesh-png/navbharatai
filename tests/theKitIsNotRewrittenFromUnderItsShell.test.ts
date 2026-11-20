// 🔴 THE GAME KIT IS A LIBRARY THE MODEL BUILDS ON, NOT A FILE IT REWRITES (failedbr #2216, 2026-11-20).
//
// The builder wrote its own src/game/core/loop.ts over the kit's; the kit's shell calls `loop.setPaused(…)`, which the
// rewrite dropped, so every write-time typecheck failed (16 → 26 → 21 → 16) and the user stopped with no game.
// Reversion: drop the kitLibraryRewriteRefusal call from guardedWrite and the dispatcher test fails.

import { describe, it, expect } from 'vitest';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { kitLibraryRewriteRefusal } from '../src/server/AgentV3/kitLibraryGuard';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const LOOP = 'src/game/core/loop.ts';
const kitLoop = recipeFilePool().get(LOOP)?.content ?? '';
// The report's shape: a hand-written loop with none of the kit's API.
const REWRITE = 'export class GameLoop {\n  start() {}\n  stop() {}\n}\n';

class MemActuator implements ActuatorPort {
  files = new Map<string, string>([[LOOP, kitLoop]]);
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) { const e: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; } return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
const dispatcher = (a: MemActuator) => { const s = new AgentEventStream(); return new ToolDispatcher(a, 'ws-kit', new WorkspaceState(s), s); };

describe("#2216: the kit's loop cannot be rewritten without its API", () => {
  it('the dispatcher refuses the write and the kit file is untouched', async () => {
    expect(kitLoop).toMatch(/setPaused/);
    const a = new MemActuator();
    const r = await dispatcher(a).dispatch({ id: 'w', name: 'write_file', input: { path: LOOP, content: REWRITE } });
    expect(`${r.content}`).toMatch(/NavBharatAI's game kit/);
    expect(`${r.content}`).toMatch(/setPaused/);
    expect(a.files.get(LOOP)).toBe(kitLoop);
  });
});

describe('the boundaries', () => {
  it('adding to the kit, keeping every export, is allowed', () => {
    expect(kitLibraryRewriteRefusal(LOOP, kitLoop, `${kitLoop}\nexport const EXTRA_SPEED = 2;\n`, 'write_file')).toBeNull();
  });
  it('a kit file the user already changed is theirs to rewrite', () => {
    const edited = `${kitLoop}\n// my change\n`;
    expect(kitLibraryRewriteRefusal(LOOP, edited, REWRITE, 'write_file')).toBeNull();
  });
  it('a non-kit file, or a platform pass, is never refused here', () => {
    expect(kitLibraryRewriteRefusal('src/game/RacingGame.tsx', kitLoop, REWRITE, 'write_file')).toBeNull();
    expect(kitLibraryRewriteRefusal(LOOP, kitLoop, REWRITE, 'evaluate-heal')).toBeNull();
  });
});

describe('a class that keeps its name but loses its methods is caught too', () => {
  it('GameLoop without setPaused is refused, naming GameLoop.setPaused', () => {
    // Keep every export name the kit has, and strip only the setPaused method from the class.
    const stripped = kitLoop.replace(/\n\s*setPaused\(paused: boolean\): void \{ this\.paused = paused; \}/, '');
    expect(stripped).not.toMatch(/setPaused\s*\(/);
    expect(kitLibraryRewriteRefusal(LOOP, kitLoop, stripped, 'write_file')).toMatch(/GameLoop\.setPaused/);
  });
});
