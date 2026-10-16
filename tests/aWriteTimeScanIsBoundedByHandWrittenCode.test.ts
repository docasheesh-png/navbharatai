/**
 * A WRITE-TIME SCAN COSTS WHAT HAND-WRITTEN CODE COSTS, WHATEVER THE MODEL ACTUALLY WROTE (Q-1126).
 *
 * Found by this repository's own CI, not by a build report: `AgentRunner.test.ts`'s
 * "recovers from an oversized turn via aggressive compaction" timed out at 20 s on run 38967985876.
 * Everything in that test is in-memory and fake, so the 12 seconds were real work — and all of it was
 * `vehicleShapeHalves`, called from `writeSteeringNotes`, i.e. on the agent's critical path at EVERY
 * write. Its patterns all begin with an unbounded greedy word-character prefix (`OBJ`, `\w*cam\w*`,
 * `\w*(?:speed|Speed)`), which backtracks out of a long word run once per start position: O(run²).
 *
 * The CLASS is not "that one regex is slow". It is "a scan of hand-written code was handed whatever the
 * model wrote, with nothing saying what hand-written code looks like", and it belongs to every write-time
 * note, not only this one. So the budget below is asserted at the DOOR — one real `write_file` through
 * `ToolDispatcher` — where a NEW scanner with the same defect fails this test even though it is not named
 * here. The unit assertions above it say what the bound is and prove it does not cost a real game its note.
 *
 * Reversion: delete the `LONG_WORD_RUN` line in `handWrittenVehicleScan.ts` and every timing assertion
 * here fails (the scan alone measured 11.9 s against the 1 s unit ceiling).
 */
import { describe, it, expect } from 'vitest';
import { vehicleShapeHalves, vehicleShapeFindings, MAX_WORD_RUN } from '../src/server/AgentV3/handWrittenVehicleScan';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

/** The exact content `AgentRunner.test.ts` writes — the input that actually timed out in CI. */
const THE_CI_INPUT = 'x'.repeat(50_000);

/** A real hand-written camera-ahead game: the camera sits on the side the car drives toward. */
const A_REAL_GAME = `
  const car = new THREE.Mesh(geo, mat);
  function tick(dt) {
    car.position.z += speed * dt;
    camera.position.z = car.position.z + 6;
  }
`;

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('🚗 the hand-written-vehicle scan is bounded by what hand-written code looks like', () => {
  it('reads a file whose longest word run is within the bound', () => {
    const halves = vehicleShapeHalves('src/game.ts', `${A_REAL_GAME}\nconst ok = '${'a'.repeat(MAX_WORD_RUN - 1)}';`);
    expect(halves.cameras.length).toBeGreaterThan(0);
    expect(halves.motions.length).toBeGreaterThan(0);
    const index = new Map([['src/game.ts', halves]]);
    expect(vehicleShapeFindings(index).some((f) => f.kind === 'camera-ahead')).toBe(true);
  });

  it('does NOT read a file carrying a word run past the bound — it is data, not a hand-written vehicle', () => {
    // The same real game, with an embedded base64-shaped asset beside it. A file like this is a generated
    // token table or an inlined image; refusing it is the same `empty` node_modules and the kit library get.
    const halves = vehicleShapeHalves('src/game.ts', `${A_REAL_GAME}\nconst LOGO = '${'A'.repeat(MAX_WORD_RUN + 1)}';`);
    expect(halves).toEqual(vehicleShapeHalves('src/game.ts', ''));
  });

  it('the bound is on the RUN, not on the file — length alone never refuses a file', () => {
    // 60,000 characters of ordinary code, far longer than the input that timed out, still read in full.
    const long = `${A_REAL_GAME}\n${'const a = 1;\n'.repeat(5_000)}`;
    expect(long.length).toBeGreaterThan(60_000);
    expect(vehicleShapeHalves('src/game.ts', long).cameras.length).toBeGreaterThan(0);
  });

  it('the input that timed out in CI is scanned in milliseconds, not seconds', () => {
    const started = Date.now();
    vehicleShapeHalves('src/big.ts', THE_CI_INPUT);
    // Measured: ~1 ms with the bound, 11,900 ms without it. One second is three orders of magnitude of
    // headroom for a loaded runner and still six times tighter than the bug.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('AND THE DOOR ITSELF STAYS CHEAP — a new scanner with the same defect fails here', async () => {
    const stream = new AgentEventStream();
    const dispatcher = new ToolDispatcher(new FakeActuator(), 'ws-bound', new WorkspaceState(stream), stream);
    const started = Date.now();
    await dispatcher.dispatch({
      type: 'tool_use', id: 't1', name: 'write_file',
      input: { path: 'big.ts', content: THE_CI_INPUT },
    } as never);
    // Measured: ~40 ms for the whole write with the bound, 12,100 ms without it. The ceiling is the budget
    // every write-time note shares, not this scan's own — that is what makes it a census.
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 30_000);
});
