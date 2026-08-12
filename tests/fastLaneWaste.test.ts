import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { oneShotStillViable, classifyForOneShot } from '../src/server/AgentV3/OneShotBuilder';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. The build's first seven minutes:
 *
 *     0s    setup begins
 *     107s  first model call (the user waits through every second of the 107)
 *     260s  SIMPLE_BUILD_FALLBACK — "could not produce the app"      ← 153s spent
 *     260s  "Trying a fast one-shot build…"
 *     410s  ONESHOT_FALLBACK — "could not generate the app"          ← 150s more
 *     422s  the real builder finally starts
 *
 * Five minutes into two lanes that both failed, before a single line of the app was written.
 *
 * The one-shot's failure was not bad luck — it was PREDICTABLE from evidence the platform already
 * held. That lane exists, in its own caller's words, for "a TRIVIAL one-file app the manifest skips".
 * The manifest had not skipped. It planned EIGHT files, and the narration said so out loud:
 * "Building 8 file(s) — one focused pass each…". A single ~8k-token call cannot emit an eight-file
 * app — that truncation limit is the documented reason the simple lane was built to replace it.
 *
 * So the one-shot was asked to do something the platform had just measured to be impossible, and the
 * user paid 150 seconds and a full generation call for the answer. The measurement existed the whole
 * time; it simply died with the closure that made it.
 */

describe('the 150 seconds spent proving something already known', () => {
  it('DECLINES the one-shot after a manifest that planned 8 files — the report\'s exact case', () => {
    expect(oneShotStillViable({ plannedFiles: 8 })).toBe(false);
  });

  it('still ALLOWS it for the single-file app this lane actually owns', () => {
    expect(oneShotStillViable({ plannedFiles: 1 })).toBe(true);
  });

  it('two files is already too many for one call', () => {
    // Not a tuning knob: 2+ files is the truncation case the simple lane was built to replace.
    expect(oneShotStillViable({ plannedFiles: 2 })).toBe(false);
  });

  it('an UNMEASURED plan stays viable — a lane that never planned has proven nothing', () => {
    /**
     * THE LINE THAT KEEPS THIS SAFE. If the plan call itself failed or returned nothing parseable,
     * we know nothing about the app's size, and declining on ignorance would silently remove a lane
     * that works today. Every unknown resolves toward today's behaviour.
     */
    for (const sb of [undefined, null, {}, { plannedFiles: 0 }, { plannedFiles: -1 }, { plannedFiles: NaN }]) {
      expect(oneShotStillViable(sb as any), JSON.stringify(sb)).toBe(true);
    }
  });

  it('it NARROWS the existing gate and never widens it', () => {
    // The tier gate still decides eligibility; this can only ever subtract an attempt, never add one.
    expect(classifyForOneShot('sonnet')).toBe(false);
    expect(classifyForOneShot('haiku') && oneShotStillViable({ plannedFiles: 1 })).toBe(true);
    expect(classifyForOneShot('haiku') && oneShotStillViable({ plannedFiles: 8 })).toBe(false);
  });
});

describe('the manifest count survives the lane that measured it', () => {
  const deps = (manifest: string) => ({
    prompt: 'a stock app for my shop',
    framework: 'react',
    scaffoldPaths: [] as string[],
    generate: async (sys: string) => (/Plan the COMPLETE file list/i.test(sys) ? manifest : '<<<FILE src/x.tsx>>>\nexport const X = () => null;\n<<<ENDFILE>>>'),
    writeFiles: async () => {},
    log: () => {},
  });

  it('reports how many files the plan found, even when the lane goes on to FAIL', () => {
    /**
     * This is the whole mechanism. On the failure path the closure's locals are gone before the
     * caller can ask — which is exactly why the caller had to guess, and guessed wrong.
     */
    const manifest = Array.from({ length: 8 }, (_, i) => `src/F${i}.tsx :: file ${i}`).join('\n');
    return runSimpleBuild({ ...deps(manifest), verify: async () => ({ ok: false, errors: 'boom', ran: true }), maxRepairs: 0 })
      .then((sb) => {
        expect(sb.ok).toBe(false);
        expect(sb.plannedFiles).toBe(8);
        // …and with that in hand, the caller now declines the lane that cost 150s.
        expect(oneShotStillViable(sb)).toBe(false);
      });
  });

  it('reports it on SUCCESS too, so one field means one thing on every path', () => {
    const manifest = Array.from({ length: 4 }, (_, i) => `src/G${i}.tsx :: file ${i}`).join('\n');
    let n = 0;
    return runSimpleBuild({
      ...deps(manifest),
      // A distinct file per focused call, the way the real lane is fed.
      generate: async (sys: string) => (/Plan the COMPLETE file list/i.test(sys)
        ? manifest
        : `<<<FILE src/G${n++}.tsx>>>\nexport const G = () => null;\n<<<ENDFILE>>>`),
    }).then((sb) => {
      expect(sb.ok).toBe(true);
      expect(sb.plannedFiles).toBe(4);
    });
  });

  it('a plan that produced NOTHING leaves it 0 — never a number nobody measured', () => {
    return runSimpleBuild(deps('sorry, I cannot help with that')).then((sb) => {
      expect(sb.ok).toBe(false);
      expect(sb.plannedFiles).toBe(0);
      expect(oneShotStillViable(sb)).toBe(true); // unknown → today's behaviour
    });
  });
});

describe('WIRING — and the report says what we decided', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('the one-shot gate reads the sibling lane\'s measurement', () => {
    expect(route).toContain('} else if (classifyForOneShot(analysis?.startTier) && oneShotStillViable(sb)) {');
  });

  it('a skipped lane is RECORDED, not silently absent', () => {
    // Silence would read in the report as "the one-shot was never eligible" — a different fact, and
    // the kind of gap that makes the next autopsy misdiagnose a build.
    expect(route).toContain("code: 'ONESHOT_SKIPPED'");
    const at = route.indexOf("code: 'ONESHOT_SKIPPED'");
    expect(route.slice(at, at + 400)).toMatch(/only fits a single-file app/);
    expect(route.slice(at, at + 400)).toContain('${sb.plannedFiles}');
  });

  it('it is only recorded when the lane was genuinely eligible and we declined it', () => {
    const at = route.indexOf("code: 'ONESHOT_SKIPPED'");
    const guard = route.slice(route.lastIndexOf('if (!sb.ok', at), at);
    expect(guard).toContain('classifyForOneShot(analysis?.startTier)');
    expect(guard).toContain('!oneShotStillViable(sb)');
  });
});
