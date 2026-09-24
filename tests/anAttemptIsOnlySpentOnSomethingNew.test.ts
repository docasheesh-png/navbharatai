import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseAttemptHistory, sameFailure, judgeRepeat, historyForModel, repeatStopMessage, MAX_HISTORY, failureSignature,
} from '../src/server/lib/mobileRepairHistory';

/**
 * AN ATTEMPT IS ONLY SPENT ON SOMETHING NEW (admin 2026-09-22, "toote hi na").
 *
 * The panel gives a failed phone build three attempts and each used to start from nothing: the server
 * could not know that the identical failure had just been "repaired" five minutes earlier. So the rules
 * refreshed the same files twice, and a blind AI fix was followed by a second one never told the first
 * had failed. These cases lock the memory that ends that.
 */
const APP = { code: 'APP_CODE_BUILD_FAILED', error: 'src/App.tsx(3,7): error TS2322: Type string is not assignable to number.' };

describe('what counts as the SAME failure', () => {
  it('the class and the tool\'s own line, with run-to-run noise removed', () => {
    expect(sameFailure(APP, { ...APP, error: `\x1b[31m${APP.error}\x1b[0m` })).toBe(true);
    expect(sameFailure(APP, { ...APP, error: `2026-09-22T16:01:30Z  ${APP.error.replace(/ +/g, '   ')}` })).toBe(true);
    expect(sameFailure(APP, { ...APP, error: `/home/runner/work/app/app/${APP.error}` })).toBe(true);
  });

  it('a different class, or a different line in the same class, is a NEW failure', () => {
    expect(sameFailure(APP, { code: 'WEB_DIR_MISSING', error: APP.error })).toBe(false);
    expect(sameFailure(APP, { ...APP, error: 'src/Other.tsx(9,1): error TS2304: Cannot find name "x".' })).toBe(false);
  });

  it('a class with no line on either side matches on the class alone — that is what a class is for', () => {
    expect(sameFailure({ code: 'GRADLEW_NOT_EXECUTABLE' }, { code: 'GRADLEW_NOT_EXECUTABLE', error: null })).toBe(true);
  });
});

describe('the verdict, and what each one honestly implies', () => {
  it('no history, or a different last failure ⇒ new', () => {
    expect(judgeRepeat([], APP)).toEqual({ kind: 'new' });
    expect(judgeRepeat([{ code: 'NPM_PEER_CONFLICT', fixedBy: 'rules' }], APP)).toEqual({ kind: 'new' });
  });

  it('🔴 the same failure after a RULES refresh ⇒ the refresh did not help; say so, skip it', () => {
    const v = judgeRepeat([{ ...APP, fixedBy: 'rules', changed: ['.github/workflows/android-apk.yml'] }], APP);
    expect(v.kind).toBe('repeat-after-rules');
    expect(historyForModel(v)).toContain('failed the SAME way');
    expect(historyForModel(v)).toContain('already in the files you see');
  });

  it('🔴 the same failure after an AI change ⇒ the model corrects ITS change rather than starting over', () => {
    const v = judgeRepeat([{ ...APP, fixedBy: 'ai', verified: false, changed: ['src/App.tsx'] }], APP);
    expect(v.kind).toBe('repeat-after-ai');
    expect(historyForModel(v)).toContain('YOUR change to src/App.tsx');
    expect(historyForModel(v)).toContain('do not repeat it');
  });

  it('🔒 the same failure after NOTHING was changed ⇒ the cycle ends; another run would fail the same way', () => {
    const v = judgeRepeat([{ ...APP, fixedBy: null }], APP);
    expect(v.kind).toBe('repeat-after-nothing');
    expect(repeatStopMessage(v)).toContain('nothing NavBharatAI could change');
    expect(repeatStopMessage({ kind: 'new' })).toBeNull();
  });

  it('only the MOST RECENT record is compared — an older failure that was really fixed is not evidence', () => {
    const v = judgeRepeat([{ ...APP, fixedBy: null }, { code: 'WEB_DIR_MISSING', fixedBy: 'rules' }], APP);
    expect(v.kind).toBe('new');
  });

  it('every sentence for the model or the user is vendor-free (White-Label Law)', () => {
    const texts = [
      historyForModel(judgeRepeat([{ ...APP, fixedBy: 'rules' }], APP)),
      historyForModel(judgeRepeat([{ ...APP, fixedBy: 'ai' }], APP)),
      historyForModel(judgeRepeat([{ ...APP, fixedBy: null }], APP)),
      repeatStopMessage(judgeRepeat([{ ...APP, fixedBy: null }], APP)),
    ].join(' ');
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Sonnet', 'Opus', 'Gemini', 'Grok', 'OpenAI']) {
      expect(texts).not.toContain(vendor);
    }
  });
});

describe('the history is DATA the client sends — bounded, typed, never an instruction', () => {
  it('drops a malformed record rather than guessing, and bounds every string', () => {
    const parsed = parseAttemptHistory([
      null, 'junk', { error: 'no code' }, { code: 'not a code!' },
      { code: 'app_code_build_failed', error: 'x'.repeat(5000), fixedBy: 'wizard', changed: [1, 'src/App.tsx', 'y'.repeat(400)] },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].code).toBe('APP_CODE_BUILD_FAILED');
    expect(parsed[0].error!.length).toBe(600);
    expect(parsed[0].fixedBy).toBeNull();
    expect(parsed[0].changed).toEqual(['src/App.tsx']);
  });

  it('keeps only the last few records', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ code: 'UNKNOWN', error: String(i) }));
    const parsed = parseAttemptHistory(many);
    expect(parsed).toHaveLength(MAX_HISTORY);
    expect(parsed[parsed.length - 1].error).toBe('19');
  });

  it('a non-array is an empty history, never a throw', () => {
    expect(parseAttemptHistory(undefined)).toEqual([]);
    expect(parseAttemptHistory('[]')).toEqual([]);
  });
});

describe('the tool\'s own last words are the signature that travels between runs', () => {
  it('takes the last content lines of the failing step, drops the runner\'s markers and timestamps, and is bounded', () => {
    const step = [
      '##[group]Build the web app',
      '2026-09-22T10:00:01.123Z npm run build',
      '2026-09-22T10:00:02.456Z ',
      '2026-09-22T10:00:03.789Z src/App.tsx(3,1): error TS2322: Type string is not assignable to number.',
      '2026-09-22T10:00:04.000Z NBAI_FAILED_STAGE=webbuild',
      '##[endgroup]',
    ].join('\n');
    const sig = failureSignature(step);
    // The line that NAMES the error is the signature; "npm run build" says nothing about which failure.
    expect(sig).toBe('src/App.tsx(3,1): error TS2322: Type string is not assignable to number.');
    expect(failureSignature('just some output\nand more output')).toBe('just some output | and more output');
    expect(failureSignature('x'.repeat(1000)).length).toBe(300);
    expect(failureSignature('')).toBe('');
  });

  it('🔴 the signature is the tool\'s ERROR line, never the stack tail that every Vite failure shares (the review\'s catch)', () => {
    const run = (imp: string) => [
      '##[group]Build the web app',
      `error during build:`,
      `[vite]: Rollup failed to resolve import "${imp}" from "src/App.tsx".`,
      '    at viteLog (file:///home/runner/work/app/app/node_modules/vite/dist/node/chunks/dep-abc.js:65123:15)',
      '    at onRollupWarning (file:///home/runner/work/app/app/node_modules/vite/dist/node/chunks/dep-abc.js:65153:9)',
      '    at Object.logger [as onLog] (file:///home/runner/work/app/app/node_modules/vite/dist/node/chunks/dep-abc.js:64801:13)',
      '##[error]Process completed with exit code 1.',
      '##[endgroup]',
    ].join('\n');
    const foo = failureSignature(run('foo'));
    const bar = failureSignature(run('bar'));
    expect(foo).toContain('Rollup failed to resolve import "foo"');
    expect(foo).not.toContain('at viteLog');
    expect(foo).not.toContain('Process completed');
    expect(sameFailure({ code: 'APP_CODE_BUILD_FAILED', error: foo }, { code: 'APP_CODE_BUILD_FAILED', error: bar })).toBe(false);
  });

  it('npm\'s per-run log path and a duration do not make the same install failure look new', () => {
    const run = (stamp: string, secs: string) => [
      'npm error code ETARGET',
      'npm error notarget No matching version found for zod@^99.0.0.',
      `npm error A complete log of this run can be found in: /home/runner/.npm/_logs/${stamp}-debug-0.log`,
      `added 0 packages in ${secs}`,
    ].join('\n');
    const a = failureSignature(run('2026-09-22T10_09_41_120Z', '12s'));
    const b = failureSignature(run('2026-09-22T10_19_03_998Z', '9s'));
    expect(sameFailure({ code: 'NPM_VERSION_NOT_FOUND', error: a }, { code: 'NPM_VERSION_NOT_FOUND', error: b })).toBe(true);
  });

  it('two runs of the same failure carry the same signature even when the timestamps differ', () => {
    const a = failureSignature('2026-09-22T10:00:03.789Z error TS2322: nope');
    const b = failureSignature('2026-09-23T11:11:11.111Z error TS2322: nope');
    expect(sameFailure({ code: 'X', error: a }, { code: 'X', error: b })).toBe(true);
  });
});

describe('the wiring — the route judges the repeat, the panel carries the history', () => {
  const root = join(__dirname, '..');
  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const route = codeOnly(readFileSync(join(root, 'src/server/routes/mobileShip.ts'), 'utf8'));
  const panel = codeOnly(readFileSync(join(root, 'src/components/ide/StoreBuildPanel.tsx'), 'utf8'));

  it('the route reads the history from the body, judges it against THIS failure, and answers every call with the signature', () => {
    expect(route).toContain("const repeat = judgeRepeat(parseAttemptHistory(rawHistory), { code: diag.code, error: failureLine });");
    expect(route).toContain('const failureLine = failureSignature(failedStepSection(normalizeLog(log)));');
    // Every answer — fixed or not, rules or AI — carries it, so the client can store it verbatim.
    expect((route.match(/failureLine[,\s}]/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it('a repeat after NOTHING ends the cycle before a model or a run is spent; a repeat after the RULES skips the rules', () => {
    expect(route).toContain("if (repeat.kind === 'repeat-after-nothing') {");
    expect(route.indexOf("repeat.kind === 'repeat-after-nothing'")).toBeLessThan(route.indexOf('const tryAiRepair = async'));
    expect(route).toContain("if (!diag.autoFixable || repeat.kind === 'repeat-after-rules') {");
    expect(route).toContain('history: historyForModel(repeat),');
  });

  it('the route says whether the sandbox could judge the failure at all, and the panel says which of three things happened', () => {
    // …and only where the runner BUILDS: a prebuilt or static repository compiles nothing on GitHub.
    expect(route).toContain("const judgeable = layout === 'built' && sandboxCanJudge({ stage: failedStage(normalizeLog(log)), code: diag.code });");
    expect(route).toContain('judgeable,');
    expect(panel).toContain('fix.judgeable === false');
    expect(panel).toContain('packaging step NavBharatAI cannot test here');
    expect(panel).toContain('could not check this one here first');
    // The exhausted-cycle sentence says "packaging-step changes" ONLY when every repair was one — an AI
    // change to app source that merely could not be checked on this request is not a packaging step.
    expect(panel).toContain('fixesUnjudgeable === fixesApplied');
    expect(panel).toContain("' None of them could be checked here first.'");
  });

  it('the panel carries one record per answer and sends it with the next autofix — before `runId`, so the pinned tail stands', () => {
    expect(panel).toContain('history.push({');
    expect(panel).toContain('error: fix.failureLine ?? null,');
    expect(panel).toContain('workflow, history, runId: finished.id, powerLevel, sessionId }');
  });
});
