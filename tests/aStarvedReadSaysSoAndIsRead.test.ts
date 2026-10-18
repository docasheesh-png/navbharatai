import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { flowStarved, flowStarvedNote, FLOW_MIN_FRAMES, playtestVerdict } from '../src/server/AgentV3/gamePlaytest';

/**
 * Q-1141 — AND IT IS MY OWN Q-1132 FIX, HALF-DONE.
 *
 * Q-1132 (#3779) added `flowStarved` / `flowStarvedNote` so a starved pixel read could be told apart
 * from one that measured and disagreed — `firmFlow` answers `0` for both, and only one of them is a
 * fact about the game. A repo-wide search on 2026-10-18 found **no consumer at all**: not the verdict,
 * not a report, not a test. The signal existed and reached nobody.
 *
 * 🔑 THE CLASS, already written down in this repo and paid for again: *"a server that returns an honest
 * field has not communicated anything until a caller reads it"* (`backendDeployWiring.ts`, after the
 * deploy route's `domainPointed` / `domainNote` / `envNote` were parsed and thrown away). Our own
 * instruments are not exempt.
 *
 * TWO CONSEQUENCES, both real:
 *   1. The REPORT stayed silent. `sceneUnread` can only speak when the app HAS a three.js scene, so a
 *      2-D canvas game's camera verdict comes from the pixel flow — and a starved flow withheld the
 *      verdict (right) and said nothing (wrong). A game whose camera was never measured read exactly
 *      like a game whose camera is fine, which is the defect Q-1038 and Q-1097 exist to prevent.
 *   2. The TEST could not tell either, so `aRacingGameIsStartedAndDriven` has now gone red under load
 *      three times (Q-1038, Q-1132, this) — each time passing on its own, 26/26.
 */
const SRC = () => stripCodeComments(readFileSync(resolve(__dirname, '..', 'src/server/AgentV3/gamePlaytest.ts'), 'utf8'));
const DRIVING = { progress: true, restart: true, driving: true };
/**
 * ⚠️ BOTH flows are set on purpose. My first fixture set only `gasFlow`, so the STEERING read was
 * `undefined` — correctly starved — and the "healthy" case emitted a note after all. The fixture was
 * wrong, not the behaviour: a real run carries both reads. Measured and corrected rather than loosened.
 */
const run = (flow: unknown, steer: unknown = flow) => ({
  ok: true, idle: 1, gas: 5, fps: 60, errorCount: 0, touch: 5, touchSurface: true,
  moves: [{ label: 'left / A', change: 5 }, { label: 'right / D', change: 5 }, { label: 'Space', change: 5 }],
  gasFlow: flow,
  steerFlow: steer,
});
const STARVED = { total: 40, pos: 1, neg: 0, pairs: 1, frames: 2 };
const HEALTHY = { total: 40, pos: 6, neg: 0, pairs: 6, frames: 12, read: 6, edge: 0 };

describe('flowStarved / flowStarvedNote — the distinction itself', () => {
  it('too few frames is starved; enough frames and no direction is NOT', () => {
    expect(flowStarved(STARVED)).toBe(true);
    expect(flowStarved(HEALTHY)).toBe(false);
    // Enough frames, votes split — a fact about the GAME, never about our probe.
    expect(flowStarved({ total: 40, pos: 3, neg: 3, pairs: 6, frames: 12 })).toBe(false);
    expect(flowStarved(null), 'no read at all cannot have measured anything').toBe(true);
  });

  it('the note says the number, so a report can print it', () => {
    const note = flowStarvedNote(STARVED) ?? '';
    expect(note).toContain('only 2 frame(s)');
    expect(note, 'and the floor it fell short of, so the number means something').toContain(String(FLOW_MIN_FRAMES));
    expect(flowStarvedNote(HEALTHY), 'a read that answered has nothing to explain').toBeNull();
  });
});

describe('🔒 the signal has a CONSUMER — the half Q-1132 left undone', () => {
  it('a starved pixel read reaches the report, in words', () => {
    const msg = playtestVerdict(run(STARVED) as never, DRIVING).message;
    expect(msg).toMatch(/could not be read from the picture/);
    expect(msg).toMatch(/drew only 2 frame/);
  });

  it('a healthy read says nothing — the note is not noise on every run', () => {
    expect(playtestVerdict(run(HEALTHY) as never, DRIVING).message).not.toMatch(/could not be read from the picture/);
  });

  it('a non-driving game says nothing either — pixels are not its verdict', () => {
    const msg = playtestVerdict(run(STARVED) as never, { progress: true, restart: true, driving: false }).message;
    expect(msg).not.toMatch(/could not be read from the picture/);
  });

  it('and it costs the app NOTHING — Q-1038\'s division, unchanged', () => {
    const score = (f: unknown) => playtestVerdict(run(f) as never, DRIVING).score!.overall;
    expect(score(STARVED)).toBe(score(HEALTHY));
  });

  it('the verdict is WITHHELD on a starved read — never an accusation', () => {
    const s = playtestVerdict(run(STARVED) as never, DRIVING).score!;
    expect(s.cameraFacesVehicle).toBeUndefined();
    expect(s.steeringMirrored).toBeUndefined();
  });

  /**
   * THE CLASS GUARD. An exported starvation signal with no reader is the defect this row is about, so
   * the census is on the SIGNALS, not on one of them: every `*Starved`/`*StarvedNote` export in the
   * playtest must be read by something other than its own definition and its own tests.
   */
  it('every starvation signal in the playtest is actually read somewhere', () => {
    const src = SRC();
    const exported = [...src.matchAll(/export function (\w*[Ss]tarved\w*)\s*\(/g)].map((m) => m[1]);
    expect(exported.length, 'the census found no signals — it would then prove nothing').toBeGreaterThanOrEqual(2);

    const root = resolve(__dirname, '..');
    const readers = new Map<string, string[]>(exported.map((n) => [n, []]));
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry)) continue;
        const rel = full.slice(root.length + 1);
        const code = stripCodeComments(readFileSync(full, 'utf8'));
        for (const name of exported) {
          // A call, not a definition and not an import line.
          const calls = [...code.matchAll(new RegExp(`\\b${name}\\(`, 'g'))].length
            - [...code.matchAll(new RegExp(`export function ${name}\\(`, 'g'))].length;
          if (calls > 0) readers.get(name)!.push(rel);
        }
      }
    };
    walk(resolve(root, 'src'));
    walk(resolve(root, 'tests'));

    /**
     * 🔴 TWO VERSIONS OF THIS CENSUS WERE WRONG BEFORE THIS ONE, AND BOTH ARE WORTH RECORDING.
     *
     * **(1) Too loose.** It asked only "is this called anywhere in src?". Measured on `main`:
     * `flowStarved(` appears exactly twice in all of `src` — its own definition, and a call **inside
     * `flowStarvedNote`**. So one orphan was the other's "consumer", and only `flowStarvedNote` showed
     * up as unread. A signal consumed solely by its own sibling has reached nobody.
     *
     * **(2) Too strict.** Demanding a call inside `playtestVerdict` itself then flagged `probeStarved`
     * / `probeStarvedNote`, which are genuinely consumed — via `sceneUnread`, one hop away, and
     * `sceneUnread` is what the verdict calls. Measured at `gamePlaytest.ts:1210`, not assumed.
     *
     * So the rule is what the defect actually is: a starvation signal must be read by something that is
     * **not another starvation signal**. Its siblings do not count; any other function does.
     */
    const SELF = 'src/server/AgentV3/gamePlaytest.ts';
    /** The defining file with the bodies of the *Starved* exports removed — so a sibling cannot vouch. */
    const selfWithoutSignalBodies = (() => {
      let out = src;
      for (const name of exported) {
        const at = out.indexOf(`export function ${name}(`);
        if (at < 0) continue;
        const open = out.indexOf('{', at);
        let depth = 0;
        let k = open;
        while (k < out.length) {
          if (out[k] === '{') depth += 1;
          else if (out[k] === '}') { depth -= 1; if (depth === 0) break; }
          k += 1;
        }
        out = out.slice(0, at) + out.slice(k + 1);
      }
      return out;
    })();
    /**
     * **(3) And the third correction: the unit is the PAIR, not the function.** Grouped by base name,
     * `probeStarved` / `probeStarvedNote` are one signal — the boolean is an exported helper, and the
     * NOTE is what reaches `sceneUnread`. Asking each function separately flagged the boolean as an
     * orphan while the signal it belongs to was plainly being read, which is a false alarm, and a
     * census that cries wolf gets switched off. What must never happen is a whole signal reaching
     * nobody — that is Q-1132's state, and that is what this asks.
     */
    const groups = new Map<string, string[]>();
    for (const n of exported) {
      const base = n.replace(/Note$/, '');
      groups.set(base, [...(groups.get(base) ?? []), n]);
    }
    const orphans = [...groups.entries()]
      .filter(([, names]) => names.every((n) => {
        const otherFiles = readers.get(n)!.filter((f) => !/\.test\.tsx?$/.test(f) && f !== SELF);
        const readByANonSignal = new RegExp(`\\b${n}\\(`).test(selfWithoutSignalBodies);
        return otherFiles.length === 0 && !readByANonSignal;
      }))
      .map(([base]) => base);
    expect(orphans, 'an honest field has communicated nothing until a caller reads it — wire it or delete it')
      .toEqual([]);
  });
});
