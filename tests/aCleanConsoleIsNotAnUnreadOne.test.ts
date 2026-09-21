import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';
import { BROWSER_DAEMON_SCRIPT } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

/**
 * 🔴 A CLEAN APP AND A BROWSER THAT NEVER RAN WERE THE SAME OBSERVABLE
 * (deep re-autopsy of build `9cca1fd5`, 2026-09-17).
 *
 * The sandbox browser daemon appends runtime errors to a console log. `rec()` is its ONLY writer and
 * it fires only ON AN ERROR — so a perfectly clean app left no file at all. `getConsoleErrors` reads
 * the absence of that file as `captured: false`, i.e. *"we never looked"*.
 *
 * So the two states the whole `captured` flag exists to separate were indistinguishable, and the
 * consequences ran in both directions at once:
 *
 *   • `RUNTIME_VERIFIED` was effectively UNREACHABLE — a clean build could not prove itself clean,
 *     because proving it needs `captured === true` and a clean build never produced the file.
 *   • the `console_errors` TOOL destructured only `{ errors }` and told the model *"the page ran
 *     clean"* on an EMPTY result — including when nothing had been read. `claimAudit.ts` exists
 *     because of exactly that sentence: a build claimed "no console errors" in the same report that
 *     recorded `RUNTIME_UNCHECKED`.
 *
 * ⚠️ NEITHER HALF CAN BE FIXED ALONE, and that is the point of this file:
 *   • the tool alone ⇒ every clean build starts reporting "the console could not be read" — a NEW
 *     false negative, worse than what it replaces;
 *   • the daemon alone ⇒ nothing changes, because the tool still ignores the flag.
 */

// ── Half 1: the daemon makes the flag mean something ─────────────────────────────────────────────

describe('🔴 the browser daemon creates its console log when the browser really launches', () => {

  // ⚠️ RETARGETED 2026-09-21, NOT WEAKENED — and the reason is this suite's own subject matter.
  //
  // This used to slice the daemon's SOURCE text out of the actuator. The 2026-09-21 autopsy found that
  // the daemon was the ONLY browser lane recording anything — `browseUrl`, the navigation the platform
  // makes on essentially every build, attached no listener at all — so the recorder moved into one
  // shared definition both lanes interpolate. The source slice stopped containing the literal touch
  // while the EMITTED script still did exactly what these four cases require.
  //
  // So they now read the emitted `BROWSER_DAEMON_SCRIPT`, which is what the sandbox really runs. Every
  // assertion below is the same claim; only the spelling of the identifiers changed (`fs` → `__nbaiFs`,
  // `LOG` → `__nbaiLog`), and the touch is now a named `recSessionExisted()` whose whole body is the
  // try/catch these cases demand.
  const daemonRaw = BROWSER_DAEMON_SCRIPT;
  /**
   * ⚠️ COMMENTS STRIPPED, and this is the FOURTH guard in one day to need it.
   *
   * The negative assertions below ask what the daemon DOES. The first draft ran them over the raw
   * slice and failed — on the word "truncate" inside the comment I had just written explaining that
   * it must never truncate. A guard that reads prose as code is measuring the text instead of the
   * claim, which is exactly the failure mode being fixed elsewhere in this same change.
   */
  const daemon = daemonRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('it touches the log file at all — otherwise "the file is missing" can never mean anything', () => {
    // ⚠️ THE CALL, NOT THE HELPER. The first retarget asserted only that the shared recorder DEFINES
    // `recSessionExisted` — which stayed true with the daemon's call deleted, so the guard passed on a
    // daemon that touched nothing. Caught by reverting the call and seeing this case survive. The
    // helper's existence is a fact about the shared module; what this suite is about is the daemon
    // invoking it.
    expect(daemon).toMatch(/^\s*recSessionExisted\(\);/m);
    expect(daemon).toContain("appendFileSync(__nbaiLog,'')");
  });

  it('🔒 AFTER the browser launches, never before — the file must mean "a session existed"', () => {
    const launch = daemon.indexOf('chromium.launch(');
    // The CALL, not the declaration: `recSessionExisted` is now a named function defined in the shared
    // recorder ABOVE the launch, and invoked below it. Matching the bare name would find the
    // definition and assert nothing — the trap this comment exists to stop someone falling into.
    const touch = daemon.search(/^\s*recSessionExisted\(\);/m);
    expect(launch).toBeGreaterThan(-1);
    expect(touch).toBeGreaterThan(launch);
  });

  it('🔒 APPEND, never write — a resumed daemon must not erase what the previous one recorded', () => {
    expect(daemon).not.toMatch(/writeFileSync\(__nbaiLog/);
    // The error recorder is still an append too; nothing in this script may truncate the log.
    expect(daemon).not.toMatch(/truncate|\{\s*flag:\s*'w'\s*\}/);
  });

  it('🔒 and it cannot take the daemon down — the browser matters more than the bookkeeping', () => {
    const at = daemon.indexOf("appendFileSync(__nbaiLog,'')");
    expect(at).toBeGreaterThan(-1);
    expect(daemon.slice(at - 20, at + 40)).toContain('try{');
    expect(daemon.slice(at, at + 60)).toContain('catch');
  });
});

// ── Half 2: the tool stops calling an unread console a clean one ─────────────────────────────────

class ConsoleActuator implements ActuatorPort {
  constructor(private readonly answer: { errors: { t: number; kind: string; text: string }[]; captured?: boolean }) {}
  async readFile(): Promise<string> { throw new Error('ENOENT'); }
  async writeFile(): Promise<void> { /* unused */ }
  async listFiles(): Promise<string[]> { return []; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
  async getConsoleErrors() { return this.answer; }
}

function ask(answer: { errors: { t: number; kind: string; text: string }[]; captured?: boolean }) {
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(new ConsoleActuator(answer), 'ws-console', new WorkspaceState(stream), stream);
  const call: ToolUse = { id: 'c1', name: 'console_errors', input: {} };
  return d.run(call, 'architect').then((r) => String(r));
}

const anError = { t: Date.now(), kind: 'pageerror', text: 'TypeError: x is not a function' };

describe('🔴 what the model is told about the console', () => {
  it('read, and genuinely empty ⇒ clean, and it says WHY it can say so', async () => {
    const out = await ask({ errors: [], captured: true });
    expect(out).toContain('the console was read');
    expect(out).toContain('clean');
  });

  it('🔴 NOT read ⇒ never "clean" — and it says plainly this is not evidence', async () => {
    const out = await ask({ errors: [], captured: false });
    expect(out).not.toContain('clean');
    expect(out).toContain('could NOT be read');
    expect(out).toContain('not evidence either way');
  });

  it('…and it tells the model what to DO about it, rather than leaving a dead end', async () => {
    const out = await ask({ errors: [], captured: false });
    expect(out.toLowerCase()).toMatch(/screenshot|browser_action/);
  });

  it('🔒 an actuator that does not report `captured` keeps the OLD wording — the port says so', async () => {
    const out = await ask({ errors: [] });
    expect(out).toContain('clean');
    expect(out).not.toContain('could NOT be read');
  });

  it('errors present ⇒ unchanged, and `captured` is irrelevant: errors ARE the capture', async () => {
    for (const captured of [true, false, undefined]) {
      const out = await ask({ errors: [anError], captured });
      expect(out, `captured=${captured}`).toContain('Runtime browser errors (1)');
      expect(out).toContain('TypeError: x is not a function');
    }
  });

  it('no sandbox at all is its own honest answer, not a clean one', async () => {
    const stream = new AgentEventStream();
    const bare: ActuatorPort = {
      readFile: async () => { throw new Error('ENOENT'); },
      writeFile: async () => {},
      listFiles: async () => [],
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      getPortUrl: async (_w: string, p: number) => `https://s-${p}.example.dev`,
    };
    const d = new ToolDispatcher(bare, 'ws-bare', new WorkspaceState(stream), stream);
    const out = String(await d.run({ id: 'c2', name: 'console_errors', input: {} } as ToolUse, 'architect'));
    expect(out).toContain('require a real cloud sandbox');
  });
});

/**
 * 🔒 The port's contract is the thing both halves lean on. It has said, all along, that an empty
 * result with `captured:false` means "could NOT check", and that an omitted flag is unknown and
 * treated as captured. Only the tool ignored it — pin the contract so the next reader does not have
 * to re-derive which of the three states they are in.
 */
describe('the port contract both halves depend on', () => {
  const DISPATCHER = readFileSync(
    fileURLToPath(new URL('../src/server/AgentV3/ToolDispatcher.ts', import.meta.url)),
    'utf8',
  );

  it('the tool reads `captured`, not just `errors`', () => {
    expect(DISPATCHER).toContain('const { errors, captured } = await this.actuator.getConsoleErrors(');
  });

  it('and it branches on an explicit `false`, so `undefined` cannot be mistaken for a denial', () => {
    expect(DISPATCHER).toContain('captured === false');
  });
});
