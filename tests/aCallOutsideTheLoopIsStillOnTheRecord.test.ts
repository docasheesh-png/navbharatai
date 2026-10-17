/**
 * 🧬 A MODEL CALL MADE OUTSIDE THE LOOP IS NOT IN `llmCalls` (build report 9c612cdb, Q-1011).
 *
 * `endgameBatchRepair` goes straight to `client.runTurn`, outside `AgentRunner`'s step loop, where the
 * three `onLlmCall` emitters live. So the endgame's repair pass — a batched call that can spend a
 * minute and a large prompt — left NO row at all, on success or failure. Every autopsy reads
 * `llmCalls`; the one place a reader would look to ask "what did the endgame actually do?" was empty.
 *
 * 🔴 AND A SECOND DEFECT IN THE SAME FUNCTION, which is the expensive one. The 150 s `withDeadline`
 * hands a signal to `runEndgameRepair`, which checks it BETWEEN steps — but the repair passed
 * `this.opts.signal` (the BUILD's) to the model, so once the deadline fired the call carried on
 * burning tokens for an answer nothing would read. **A deadline that cannot cancel is a comment.**
 *
 * 🔑 THE FIX DOES NOT TRADE STOP FOR THE DEADLINE. Switching to the deadline's signal alone would have
 * made a user's Stop stop reaching the call. `withDeadline` takes a `parent`, so the build's signal is
 * passed as that parent and the one signal fires on EITHER — which is why both call sites are asserted
 * below, not just the function.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');
const runner = read('src/server/AgentV3/AgentRunner.ts');
const endgame = read('src/server/AgentV3/EndgameRepair.ts');
const route = read('src/server/routes/agentv3.ts');
const recorder = read('src/server/AgentV3/recordedTextCall.ts');

/** Comment text is evidence, not code — a class named in a header must not fail its own census. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('every model call AgentRunner makes is on the record', () => {
  const code = codeOnly(runner);

  it('the census: every `client.runTurn` in AgentRunner, and each one is recorded', () => {
    // The BODY, not a name: a third call site added under any name is caught by this count.
    const sites = (code.match(/client\.runTurn\(/g) ?? []).length;
    expect(sites).toBe(2); // the step loop's own turn, and the endgame batch repair
    // FOUR emitters: the loop's own three (a stop, a failure, a success) plus `recordOffLoopCall`,
    // which is the only one an off-loop call may use. A new call site that records nothing leaves
    // this at four while `client.runTurn(` goes to three — which is exactly how this census catches it.
    expect((code.match(/onLlmCall\?\.\(\{/g) ?? []).length).toBe(4);
    expect((code.match(/recordOffLoopCall\(\{/g) ?? []).length).toBe(2); // success AND failure
  });

  it('the endgame repair records BOTH outcomes — a failed call is a call that was paid for', () => {
    const fn = code.slice(code.indexOf('const endgameBatchRepair = async ('), code.indexOf('let steps = 0;'));
    expect(fn).toContain('recordOffLoopCall({');
    expect(fn).toMatch(/ok: true/);
    expect(fn).toMatch(/ok: false/);
    // The error text travels with the failed row, or the row says nothing about why.
    expect(fn).toContain("error: err instanceof Error ? err.message : String(err)");
    // And the throw still propagates: recording a failure must not swallow it.
    expect(fn).toContain('throw err;');
  });

  it('the recorder invents nothing the call does not know', () => {
    const rec = code.slice(code.indexOf('const recordOffLoopCall = ('), code.indexOf('const endgameBatchRepair = async ('));
    expect(rec).toContain('toolCalls: 0');            // an off-loop repair call is given no tools
    expect(rec).toContain('latencyMs: Date.now() - c.startedAt');
    // No chain-split times: `answerMs`/`fallbackMs`/`openMs` are the loop's measurements, and putting
    // numbers in the report that nothing measured is the defect this row is about, one level down.
    for (const invented of ['answerMs', 'fallbackMs', 'openMs', 'firstOutputMs', 'stopCause']) {
      expect(rec).not.toContain(invented);
    }
    // It can never break a build. Read from the RAW source: `codeOnly` strips the inline comment
    // that is part of this very idiom.
    const rawRec = runner.slice(runner.indexOf('const recordOffLoopCall = ('), runner.indexOf('const endgameBatchRepair = async ('));
    expect(rawRec).toContain('catch { /* diagnostics capture is best-effort */ }');
  });
});

describe('the 150 s deadline can actually cancel the call it bounds', () => {
  it('the repair takes a signal and uses it, falling back to the build\'s', () => {
    const code = codeOnly(runner);
    const fn = code.slice(code.indexOf('const endgameBatchRepair = async ('), code.indexOf('let steps = 0;'));
    expect(fn).toContain('signal?: AbortSignal');
    expect(fn).toContain('signal: signal ?? this.opts.signal');
    // The old body passed the build's signal unconditionally — the whole defect.
    expect(fn).not.toMatch(/signal:\s*this\.opts\.signal\s*,/);
  });

  it('BOTH deadline sites pass the build\'s signal as the PARENT, so Stop is not traded away', () => {
    const code = codeOnly(runner);
    expect(code).toContain("150_000, 'errtrend-repair', this.opts.signal,");
    expect(code).toContain("150_000, 'endgame-repair', this.opts.signal);");
    // Neither site may go back to an unparented deadline.
    expect(code).not.toContain("150_000, 'errtrend-repair')");
    expect(code).not.toContain("150_000, 'endgame-repair')");
  });

  it('and the repair contract carries the signal, so the deadline reaches the model', () => {
    expect(endgame).toMatch(/llmRepair\?\(errorText: string, files: Array<\{ path: string; content: string \}>, signal\?: AbortSignal\)/);
    expect(codeOnly(endgame)).toContain('io.llmRepair(out2 + causes, subset, io.signal)');
  });

  it('the premise holds: withDeadline really honours a parent', () => {
    const utils = read('src/server/AgentV3/asyncUtils.ts');
    expect(utils).toContain("parent?.addEventListener('abort', onParent, { once: true });");
    expect(utils).toMatch(/export async function withDeadline<T>\(fn: \(signal: AbortSignal\) => Promise<T>, ms: number, label: string, parent\?: AbortSignal\)/);
  });
});


/**
 * 🧬 Q-1125 (2026-10-17) — AND THE SAME CLASS LIVED IN THE ROUTE, FIVE TIMES OVER.
 *
 * `AgentRunner` is not the only place a model call is made. The BUILD ROUTE makes text-only aux calls of
 * its own, and the census above could never see them. What it found:
 *
 *   · the blueprint step recorded SUCCESS ONLY — its 30 s bound and every error left no row at all,
 *     which is Q-1011's own asymmetry one level down;
 *   · the agentic lane's FOUR post-build repair gates (typecheck, missing-files, syntax, missing-export)
 *     called `makeFastTextRunner().runTurn(...)` raw and recorded NOTHING, success or failure.
 *
 * Two of the three sites the queue row named — the roadmap planner and the project planner — already
 * recorded both outcomes. The row was written from the shape of Q-1011, not from a census; this test is
 * the census, and it is what a future row should be written from.
 *
 * 🔒 WHAT THIS LOCKS IS THE CLASS, NOT THE FIVE. A new aux call written the old way — the raw runner,
 * or a `recordLlmCall` only on the happy path — fails here WITHOUT being named, because the thing
 * asserted is that no raw `runTurn` on either text-runner factory exists at all.
 */
describe('a text-only call the build route makes is on the record too', () => {
  const code = codeOnly(route);

  it('the census: NO raw text-runner call survives in the route', () => {
    // The two factories every aux text call is built from. A `.runTurn(` straight off either one is a
    // call nothing records — the exact shape the four repair gates had.
    expect(code).not.toMatch(/makeFastTextRunner\([^)]*\)\.runTurn\(/);
    expect(code).not.toMatch(/makePlanTextRunner\([^)]*\)\.runTurn\(/);
  });

  it('…and every remaining `runTurn` in the route is one of the known, recorded callers', () => {
    const lines = code.split('\n').filter((l) => l.includes('.runTurn('));
    // Exactly five, and each is accounted for below. A SIXTH — a new aux call site — fails this count.
    expect(lines.length).toBe(5);
    const joined = lines.join('\n');
    // Two planners that have always recorded both outcomes (asserted individually further down).
    expect(joined).toContain('const rmCall = makePlanTextRunner((used) => { rmProvider = used; }).runTurn({');
    expect(joined).toContain('const call = makePlanTextRunner((used) => { ppProvider = used; }).runTurn({');
    // The fast lane's own recording wrapper — `fastGenerateOnce` records success AND failure.
    expect(joined).toContain('t = await runner.runTurn({');
    // The judge chain's Claude backstop: a runner DEFINITION, not a build call — the judge's own
    // recording is a separate path and not what this row is about.
    expect(joined).toContain("runTurn: (a) => new ClaudeClient(undefined, { maxRetries: 1 }).runTurn(a)");
    // The admin-only `/api/agentv3/diag?test=1` probe. It is not a build: there is no `buildDiag` in
    // its scope and nothing to attach a row to. Named here so it is an allowance, not an oversight.
    expect(joined).toContain('const turn = await client.runTurn({');
  });

  it('the four repair gates go through the one door', () => {
    expect((code.match(/recordedRepairCall\(/g) ?? []).length).toBe(4); // the four gates
    expect(code).toContain('const recordedRepairCall = (system: string, user: string) => {');
    for (const gate of ['tscgate-w', 'missfiles-w', 'syntax-w', 'missexport-w']) {
      expect(code).toContain(gate); // the gate is still there…
    }
    // …and the door it is built on hands both its outcomes to the real sink.
    expect(code).toContain('recordLlmCall: (row) => buildDiag.recordLlmCall(row),');
  });

  it('the blueprint step no longer hand-rolls its bound, so its expiry is on the record', () => {
    expect(code).toContain("timeoutMs: 30_000, timeoutMessage: 'blueprint step timed out'");
    // The old shape: a private race whose losing call was simply abandoned, with nothing written down.
    expect(code).not.toContain('const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(\'blueprint step timed out\')), 30_000));');
    // And the usage attribution below it still receives the provider the chain reported (a fix must not
    // trade one problem for another — `bpProvider` feeds `captureTurnUsage`).
    expect(code).toContain('makeRunner: () => makePlanTextRunner((used) => { bpProvider = used; }),');
    expect(code).toContain('captureTurnUsage(bpProvider,');
    // 🔴 AND THE PLAN LADDER NAMES IT, NOT THE BUILD ONE. An earlier draft routed this row through
    // `fastLaneCallIdentity`, whose Claude default is the BUILD ladder's rung — caught by
    // `aBuildIsNamedByItsLadderNotByClaude` §4, which pins this exact form for all three planners.
    expect(code).toContain('model: answeringModel({ answered, planned: claudeRungModelId(bpProvider) ?? null, family: bpProvider }),');
  });

  it('both planners record BOTH outcomes — unchanged, and asserted so a later edit cannot quietly drop one', () => {
    for (const marker of ['rmProvider', 'ppProvider']) {
      const i = code.indexOf(`let ${marker} = ''`);
      expect(i).toBeGreaterThan(-1);
      const fn = code.slice(i, i + 6000);
      expect(fn).toMatch(/ok: true/);
      expect(fn).toMatch(/ok: false/);
    }
  });
});

describe('the one door records what happened and invents nothing else', () => {
  const code = codeOnly(recorder);

  it('both outcomes leave a row, and a failure still propagates', () => {
    expect(code).toContain('ok: true,');
    expect(code).toContain('ok: false,');
    expect(code).toContain('error: err instanceof Error ? err.message : String(err),');
    expect(code).toContain('throw err;');
  });

  it('it never guesses who answered, and never invents a measurement', () => {
    // `reported` is passed through to the caller's resolver, which is what refuses to name a vendor
    // for a call no rung ever served (autopsy dcce5d26).
    expect(code).toContain('deps.identify(reported, usedProvider, t.model)');
    expect(code).toContain('deps.identify(reported, usedProvider)');
    // The sink keeps the NAME `recordLlmCall` and takes an object LITERAL, so every call that goes
    // through this door stays visible to `aChainsClockIsNotItsAnswerersClock`'s success-row census. A
    // door that hid its rows from a census would be worse than the copies it replaced.
    expect(code).toContain('deps.recordLlmCall({');
    // The chain's own split times come from the turn, and are simply ABSENT on a failure — because on a
    // failure nothing measured them. Hand-written numbers are the defect this module is about.
    expect((code.match(/answerTimeOf\(/g) ?? []).length).toBe(1);
    const failure = code.slice(code.indexOf('} catch (err) {'));
    for (const invented of ['answerMs', 'fallbackMs', 'openMs', 'firstOutputMs', 'answerTimeOf']) {
      expect(failure).not.toContain(invented);
    }
  });

  it('recording can never break a build, and a lost race does not hold a timer open', () => {
    expect((recorder.match(/catch \{ \/\* diagnostics capture is best-effort \*\/ \}/g) ?? []).length).toBe(2);
    expect(code).toContain('if (timer !== undefined) clearTimeout(timer);');
  });
});
