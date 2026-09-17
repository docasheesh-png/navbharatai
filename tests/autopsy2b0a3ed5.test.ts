// AUTOPSY 2b0a3ed5 — the calculator build a user stopped after 66 seconds, and was right to.
//
// THE RUN. Weak tier, free. 7 s of setup, then ONE model call that took **55.7 seconds and returned
// 27 output tokens** — 0.48 tokens/second, against the ~33/s this engine's own budget arithmetic
// assumes. What it said in that minute was *"I'll quickly check the existing calculator template and
// finish it up"*, followed by a single `read_file`. The user pressed Stop. 63 of the 66 seconds had
// shown them nothing at all.
//
// The report then made four separate claims that were not true:
//   • "Design consistency 68/100 (C) across 8 file(s)" — filed as an unresolved problem against a
//     user who had written nothing. Those eight files are NavBharatAI's own Calculator template.
//   • "Your files so far are saved" — nothing had been written; the only tool call was a READ.
//   • "Not shippable — the build did not succeed" — nothing failed; a person pressed a button.
//   • "Build did not succeed, but no specific error was captured" — the cause was recorded twice in
//     the same document (USER_STOPPED_BUILD, CANCELLED_BUILD_CHARGED).
// …and `providerChain` listed 104 GLM pool keys, ending before KIMI was ever named.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isPlatformSeededFile, projectHasUserCode, userAuthoredPaths, modelAuthoredPaths,
  _resetPlatformSeededIndex,
} from '../src/server/AgentV3/platformAuthored';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { deriveRootCause, stoppedByUser } from '../src/server/AgentV3/BuildDiagnostics';
import { releaseGate } from '../src/server/AgentV3/releaseGate';
import { describeRunnerChain, firstRungLabel } from '../src/server/AgentV3/runnerChainSummary';
import {
  recordSlowSample, isRungTooSlow, isStalledTurn, describeSlowRung,
  EMPTY_SLOW_RUNG_STATE, SLOW_RUNG_STALL_MS, SLOW_RUNG_STALL_TOKENS,
} from '../src/server/AgentV3/slowRungBench';
import { startBandLabel } from '../src/server/AgentV3/RequestAnalyser';

const calculator = GOLDEN_SCAFFOLDS.find((g) => /calculator/i.test(g.label) || g.id === 'calculator');
const templateFiles = calculator ? goldenScaffoldFiles(calculator) : {};

describe('🔴 our own template is not the user\'s app', () => {
  it('the reported case: a pre-seeded, untouched template is NOT a user app', () => {
    // 12 files, model wrote none. The old guard said "yes there is a user app" because the scaffold
    // itself had populated both `storeFiles` and `writtenFiles`.
    expect(Object.keys(templateFiles).length).toBeGreaterThan(0);
    expect(projectHasUserCode(templateFiles)).toBe(false);
    expect(userAuthoredPaths(templateFiles)).toEqual([]);
  });

  it('ONE changed byte makes the app theirs, and everything after that is fair to grade', () => {
    const [first] = Object.keys(templateFiles);
    const edited = { ...templateFiles, [first]: `${templateFiles[first]}\n// the model changed this` };
    expect(projectHasUserCode(edited)).toBe(true);
    expect(userAuthoredPaths(edited)).toEqual([first]);
  });

  it('a NEW file the model wrote is always the user\'s', () => {
    expect(projectHasUserCode({ ...templateFiles, 'src/Keypad.tsx': 'export const Keypad = () => null;' })).toBe(true);
  });

  it('🔒 the safe direction is "the user\'s" — anything unrecognised counts as theirs', () => {
    // A future template nobody registered here, a renamed path, a file we do not know: all of them
    // keep today's behaviour. Only a byte-exact match is ever excused.
    expect(projectHasUserCode({ 'src/App.tsx': 'something we have never seen' })).toBe(true);
    expect(isPlatformSeededFile('src/App.tsx', 'not ours')).toBe(false);
    expect(isPlatformSeededFile(null, 'x')).toBe(false);
    expect(isPlatformSeededFile('a.ts', null)).toBe(false);
  });

  it('an EMPTY project has no user code either', () => {
    expect(projectHasUserCode({})).toBe(false);
    expect(projectHasUserCode(null)).toBe(false);
  });

  it('path spelling does not decide it — `./src/App.tsx` is the same file', () => {
    const [first, content] = Object.entries(templateFiles)[0];
    expect(isPlatformSeededFile(`./${first}`, content)).toBe(true);
  });

  it('the cache can be rebuilt and answers the same', () => {
    _resetPlatformSeededIndex();
    expect(projectHasUserCode(templateFiles)).toBe(false);
  });
});

describe('🔎 the authorship set the readiness gate reads must not contain our template', () => {
  it('modelAuthoredPaths strips the pre-seeded entries the golden scaffold put in writtenFiles', () => {
    // `buildAuthorship.ts`'s own header says scaffold files are not in the authored set. That is true
    // of the actuator's boilerplate and FALSE of the golden scaffold, which does `writtenFiles.set`.
    const written = new Map(Object.entries(templateFiles));
    expect(modelAuthoredPaths(written)).toEqual([]);
    written.set('src/History.tsx', 'export const History = () => null;');
    expect(modelAuthoredPaths(written)).toEqual(['src/History.tsx']);
  });

  it('never throws on a hostile or absent map', () => {
    expect(modelAuthoredPaths(null)).toEqual([]);
    expect(modelAuthoredPaths(undefined)).toEqual([]);
  });
});

describe('🔴 a build the user stopped is not a build that failed', () => {
  const stopIssue = {
    ts: 1, phase: 'build' as const, severity: 'info' as const, code: 'USER_STOPPED_BUILD',
    message: 'The user asked for this build to stop, and it was stopped.', autoResolved: true,
  };

  it('rootCause names the stop instead of "no specific error was captured"', () => {
    const rc = deriveRootCause({ issues: [stopIssue], ok: false });
    expect(rc).toContain('USER stopped this build');
    expect(rc).not.toContain('no specific error was captured');
  });

  it('…and still names the worst thing seen, demoted to what it is', () => {
    const rc = deriveRootCause({
      issues: [
        stopIssue,
        { ts: 2, phase: 'build', severity: 'warning', code: 'X', message: 'a real warning', autoResolved: false },
      ],
      ok: false,
    });
    expect(rc).toContain('USER stopped this build');
    expect(rc).toContain('a real warning');
    expect(rc).toContain('may be unrelated');
  });

  it('⚠️ an ENGINE-initiated stop is never filed under "the user abandoned it"', () => {
    const engineStop = {
      ...stopIssue,
      message: 'The build was stopped by the engine while working on a request NavBharatAI itself composed — not by the user.',
    };
    expect(stoppedByUser([engineStop])).toBe(false);
    expect(deriveRootCause({ issues: [engineStop], ok: false })).not.toContain('USER stopped');
  });

  it('🔒 a SUCCESSFUL build stopped by the user is never headlined "STOPPED"', () => {
    // #3004 landed the same day for exactly this shape: a build that succeeded on every measure was
    // headlined "Build outcome: STOPPED". A user can press Stop on a build that already produced a
    // working app, so this branch must never outrank the ok===true guards below it.
    expect(deriveRootCause({ issues: [stopIssue], ok: true })).not.toContain('USER stopped');
  });

  it('a genuine failure is untouched', () => {
    expect(stoppedByUser([])).toBe(false);
    expect(deriveRootCause({ issues: [], ok: false })).toContain('no specific error was captured');
  });

  it('the release gate stops blaming the app for a decision the user made', () => {
    const ev = {
      buildOk: false, preview: 'not-run', pages: 'not-run', journeys: 'not-run',
      typecheck: 'not-run', tests: 'not-run',
    } as never;
    const findings = { blockers: 0, highSeverity: 0, warnings: 0 };
    const failed = releaseGate(ev, findings);
    expect(failed.headline).toBe('Not shippable — the build did not succeed.');

    const stopped = releaseGate({ ...(ev as object), stoppedByUser: true } as never, findings);
    // 🔒 STILL RED. Nothing was proven, so nothing may be shipped — only the reason is told truthfully.
    expect(stopped.state).toBe('red');
    expect(stopped.headline).toContain('you stopped this build');
    expect(stopped.headline).not.toContain('did not succeed');
  });
});

describe('🔴 the first call had no watchdog, and it is the one the user sits through', () => {
  const REPORTED = { outputTokens: 27, observedMs: 55_723, measured: true };

  it('the reported turn is a STALL on its own single sample', () => {
    expect(isStalledTurn(REPORTED)).toBe(true);
    const state = recordSlowSample(EMPTY_SLOW_RUNG_STATE, REPORTED);
    expect(state.calls).toBe(1);
    expect(isRungTooSlow(state)).toBe(true); // the trend bench alone would need 3 calls and 90s
    expect(state.stalled).toBe(true);
  });

  it('and it says so in its own words, not as a one-sample statistic', () => {
    const state = recordSlowSample(EMPTY_SLOW_RUNG_STATE, REPORTED);
    const line = describeSlowRung(state, 'glm-4.7-flashx', 'skipped');
    expect(line).toContain('STALLED');
    expect(line).toContain('56s');
    expect(line).not.toMatch(/over 1 calls/);
  });

  it('🔒 a PRODUCTIVE long turn is never a stall', () => {
    // A real file takes a while and produces a lot. That is work, not a stall.
    expect(isStalledTurn({ outputTokens: 4000, observedMs: 90_000, measured: true })).toBe(false);
    expect(isStalledTurn({ outputTokens: SLOW_RUNG_STALL_TOKENS + 1, observedMs: 60_000, measured: true })).toBe(false);
  });

  it('🔒 a QUICK small turn is never a stall', () => {
    expect(isStalledTurn({ outputTokens: 27, observedMs: 3_000, measured: true })).toBe(false);
    expect(isStalledTurn({ outputTokens: 27, observedMs: SLOW_RUNG_STALL_MS - 1, measured: true })).toBe(false);
  });

  it('🔒 an UNMEASURED turn is never a stall — we do not act on figures we do not have', () => {
    // A stream without `include_usage` reports zero tokens. Scoring that as "produced nothing" would
    // retire a healthy vendor on a number nobody measured — the law the wallet already obeys.
    expect(isStalledTurn({ outputTokens: 0, observedMs: 55_723, measured: false })).toBe(false);
    expect(recordSlowSample(EMPTY_SLOW_RUNG_STATE, { outputTokens: 0, observedMs: 55_723, measured: false }))
      .toBe(EMPTY_SLOW_RUNG_STATE);
  });

  it('the trend bench is unchanged — three calls and 90s are still required for a slow TREND', () => {
    let st = EMPTY_SLOW_RUNG_STATE;
    // Well past the ratio, but small and quick: neither a stall nor yet a trend.
    for (let i = 0; i < 2; i++) st = recordSlowSample(st, { outputTokens: 300, observedMs: 30_000, measured: true });
    expect(st.calls).toBe(2);
    expect(isRungTooSlow(st)).toBe(false);
  });

  it('stall detection can be switched off without touching the trend bench', () => {
    expect(isStalledTurn(REPORTED, { AGENTV3_SLOW_RUNG_STALL_TOKENS: '0' } as never)).toBe(false);
    expect(isStalledTurn(REPORTED, { AGENTV3_SLOW_RUNG_BENCH: 'off' } as never)).toBe(true); // detection is pure…
    const st = recordSlowSample(EMPTY_SLOW_RUNG_STATE, REPORTED, { AGENTV3_SLOW_RUNG_BENCH: 'off' } as never);
    expect(isRungTooSlow(st, { AGENTV3_SLOW_RUNG_BENCH: 'off' } as never)).toBe(false); // …the kill switch decides
  });

  it('🔴 a BLANK env value means UNSET, not zero — this file shipped that bug and this caught it', () => {
    // `Number('')` is 0, not NaN. The first draft of `slowRungStallTokens` accepted that as a
    // deliberate zero, so with the key absent the ceiling was 0 and stall detection never ran at all
    // — a guard that looked configured and did nothing. The same trap the referral tunables record.
    expect(isStalledTurn(REPORTED, {} as never)).toBe(true);
    expect(isStalledTurn(REPORTED, { AGENTV3_SLOW_RUNG_STALL_TOKENS: '' } as never)).toBe(true);
    expect(isStalledTurn(REPORTED, { AGENTV3_SLOW_RUNG_STALL_TOKENS: '   ' } as never)).toBe(true);
    expect(isStalledTurn(REPORTED, { AGENTV3_SLOW_RUNG_STALL_MS: '' } as never)).toBe(true);
    // …and an explicit zero is still honoured, because nobody types one by accident.
    expect(isStalledTurn(REPORTED, { AGENTV3_SLOW_RUNG_STALL_TOKENS: '0' } as never)).toBe(false);
  });

  it('a junk stall clock falls back rather than disabling the guard', () => {
    expect(isStalledTurn(REPORTED, { AGENTV3_SLOW_RUNG_STALL_MS: 'soon' } as never)).toBe(true);
    expect(isStalledTurn(REPORTED, { AGENTV3_SLOW_RUNG_STALL_MS: '5' } as never)).toBe(true); // below the floor ⇒ default
  });
});

describe('🔴 a key pool must not eat the chain line', () => {
  it('the reported chain finally reaches KIMI and Haiku', () => {
    const pool = Array.from({ length: 104 }, (_, i) => ({
      name: i === 0 ? 'GLM' : `GLM#${i + 1}`, modelId: 'glm-4.7-flashx', reportAs: 'GLM',
    }));
    const line = describeRunnerChain([...pool, { name: 'KIMI', modelId: 'kimi-k2.7-code' }, { name: 'CLAUDE_HAIKU' }]);
    expect(line).toContain('KIMI');
    expect(line).toContain('CLAUDE_HAIKU');
    expect(line).toContain('×104'); // "three keys were tried" survives as a count
    expect(line).not.toContain('more');
  });
});

describe('🔴 the report must not name engines the build never planned to use', () => {
  it('plannedModel comes from the ladder\'s FIRST rung, not the Claude backstop', () => {
    expect(firstRungLabel([
      { name: 'GLM', modelId: 'glm-4.7-flashx' },
      { name: 'KIMI', modelId: 'kimi-k2.7-code' },
      { name: 'CLAUDE_HAIKU' },
    ])).toBe('GLM(glm-4.7-flashx)');
    expect(firstRungLabel([])).toBeUndefined();
  });

  it('a pool rung reports under its family', () => {
    expect(firstRungLabel([{ name: 'GLM#7', modelId: 'glm-5.3', reportAs: 'GLM' }])).toBe('GLM(glm-5.3)');
  });

  it('"gemini" is a complexity BAND, and the report says so instead of naming a provider', () => {
    // Gemini has been on no build ladder since the three-ladder rewrite, yet the report said the
    // build started on it. The key is kept (telemetry groups by it); the meaning is now stated.
    expect(startBandLabel('gemini')).toBe('cheapest band');
    expect(startBandLabel('opus')).toBe('heaviest band');
    expect(startBandLabel('nonsense')).toBe('unknown band');
    expect(startBandLabel(undefined)).toBe('unknown band');
  });
});

describe('the wiring — each fix reaches the place that was wrong', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const runner = readFileSync(join(process.cwd(), 'src/server/AgentV3/AgentRunner.ts'), 'utf8');

  it('the quality lint asks whether a USER app exists, not whether files exist', () => {
    expect(route).toContain('const hasUserApp = projectHasUserCode(integrityFiles);');
    expect(route).not.toContain('const hasUserApp = Object.keys(storeFiles).length > 0');
  });

  it('the authorship set excludes what the platform seeded', () => {
    expect(route).toContain('setAuthoredFiles(() => modelAuthoredPaths(writtenFiles))');
  });

  it('"is there work to resume from" counts only files the MODEL wrote', () => {
    expect(route).toContain('hasExistingFiles: () => modelAuthoredPaths(writtenFiles).length > 0');
  });

  it('a READ is not building — the saved-work claim reads the producing tool calls', () => {
    expect(runner).toContain('producingToolUses > 0 || this.opts.hasExistingFiles?.() === true');
    expect(runner).toContain('turn.toolUses.filter(toolUseCouldProduceWork)');
  });

  it('the gate learns about the stop from the same timeline rootCause reads', () => {
    expect(route).toContain('gateEvidence.stoppedByUser = stoppedByUser(');
  });
});
