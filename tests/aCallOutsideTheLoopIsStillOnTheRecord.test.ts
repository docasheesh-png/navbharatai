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
