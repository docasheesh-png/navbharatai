import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { typecheckEvidenceFromCommands, looksLikeTypecheckCommand } from '../src/server/AgentV3/TscGate';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

/**
 * 🔴 THE PROOF DIED INSIDE THE TOOL (autopsy, build e4ebcb5f, 2026-09-17).
 *
 * That report's timeline shows `▶ typecheck` → `✓ typecheck (5s)` and the agent's own next line,
 * "Good news! The app compiles fine." Its release gate, 111 seconds later, told the user:
 *
 *     NOT established: … the typecheck did not run
 *
 * Both were in the same report. `gateEvidence.typecheck` is filled by the deterministic G3 gate —
 * which only runs when the build is already marked `ok`, and this one was not — with
 * `typecheckEvidenceFromAgentCommands()` as the fallback. That fallback reads the recorded SHELL
 * COMMAND log, and the `typecheck` TOOL was the one command path that never reported through
 * `onCommand`: `bash`, `run_tests` and the cross-language checks all did. The whole report carried
 * exactly ONE command, `npm run dev`.
 *
 * This is one named instance of the shared EVIDENCE LEDGER that CLAUDE.md records as an OPEN root
 * cause (autopsy 697b38ee) — the ledger itself stays open; this door is closed.
 */
class TsProjectActuator implements ActuatorPort {
  files = new Map<string, string>([
    ['tsconfig.json', '{"compilerOptions":{"strict":true}}'],
    ['src/App.tsx', 'export default function App() { return <div>hi</div>; }'],
  ]);
  ran: string[] = [];
  /** What a clean `tsc --noEmit` prints: nothing at all. */
  tscOutput = { exitCode: 0, stdout: '', stderr: '' };

  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, command: string) {
    this.ran.push(command);
    if (/\btsc\b/.test(command)) return this.tscOutput;
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

type Recorded = { command: string; exitCode: number | null; stdout: string; stderr: string; durationMs: number };

function dispatcherWithCommandLog(act: ActuatorPort) {
  const recorded: Recorded[] = [];
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  const d = new ToolDispatcher(
    act, 'ws-1', state, stream,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    (c) => recorded.push(c),
  );
  return { d, recorded };
}

const typecheckCall: ToolUse = { id: 'tc1', name: 'typecheck', input: {} };

describe("the typecheck tool's real tsc run reaches the build's command log", () => {
  it('🔴 a CLEAN typecheck is recorded, and the release-gate fallback then reads it as passed', async () => {
    const act = new TsProjectActuator();
    const { d, recorded } = dispatcherWithCommandLog(act);

    const out = await d.dispatch(typecheckCall, 'architect');
    expect(out.content).toContain('type-checks clean');

    const tsc = recorded.filter((c) => looksLikeTypecheckCommand(c.command));
    expect(tsc.length).toBeGreaterThan(0);
    // The exact question the release gate asks — it used to answer "the typecheck did not run".
    expect(typecheckEvidenceFromCommands(recorded)).toBe('passed');
  });

  it('a FAILING typecheck is recorded honestly as failed, not hidden', async () => {
    const act = new TsProjectActuator();
    act.tscOutput = { exitCode: 2, stdout: "src/App.tsx(1,8): error TS2304: Cannot find name 'x'.", stderr: '' };
    const { d, recorded } = dispatcherWithCommandLog(act);

    const out = await d.dispatch(typecheckCall, 'architect');
    expect(out.content).toContain('TYPE ERROR');
    expect(typecheckEvidenceFromCommands(recorded)).toBe('failed');
  });

  it('🔒 the exit code is recorded as null, so it can never read as a FAILED sandbox command', async () => {
    // `robustTscCommand` pipes through `head`, so the shell's exit status is head's, not tsc's.
    // `recordCommand` treats a non-zero, non-null code as a real failure (SANDBOX_CMD_FAILED, an
    // unresolved ERROR) — which `shippingIssueCount` counts and the release gate turns RED. Reporting
    // an honest "we do not have a meaningful exit code" is what stops this fix causing the exact
    // failure it exists to remove. `typecheckEvidenceFromCommands` reads the OUTPUT, never the code.
    const act = new TsProjectActuator();
    const { d, recorded } = dispatcherWithCommandLog(act);
    await d.dispatch(typecheckCall, 'architect');

    const tsc = recorded.filter((c) => looksLikeTypecheckCommand(c.command));
    expect(tsc.length).toBeGreaterThan(0);
    for (const c of tsc) expect(c.exitCode).toBeNull();
  });

  it('a project with no TypeScript records no tsc command and invents no verdict', async () => {
    const act = new TsProjectActuator();
    act.files = new Map([['index.html', '<html></html>'], ['app.js', 'console.log(1)']]);
    const { d, recorded } = dispatcherWithCommandLog(act);

    await d.dispatch(typecheckCall, 'architect');
    expect(recorded.filter((c) => looksLikeTypecheckCommand(c.command))).toHaveLength(0);
    expect(typecheckEvidenceFromCommands(recorded)).toBeUndefined();
  });

  it('a dispatcher with NO command log still works — reporting is best-effort, never load-bearing', async () => {
    const act = new TsProjectActuator();
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-1', new WorkspaceState(stream), stream);
    await expect(d.dispatch(typecheckCall, 'architect')).resolves.toBeTruthy();
  });
});
