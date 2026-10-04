// Autopsy Sur Taal (2026-10-04, workspace …1dda446e): our own "Continue building" button did not resume a paused
// project plan, four parallel specialists each built the whole app, and the third build ran its 25-minute window
// into a RED gate. Every test here reads the report's real input where one exists. The sizing, Devanagari-domain,
// phone-power and palette items of the same report are #3506's (another session) and are not repeated here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isPlatformContinuePrompt, CONTINUE_INTERRUPTED_BUILD_PROMPT, CONTINUE_PAST_BUDGET_PROMPT, CONTINUE_AND_FIX_BUILD_PROMPT,
} from '../src/lib/continueBuildPrompts';
import { isContinuationMessage } from '../src/server/AgentV3/ProjectPlan';
import { classifyIntentWithConfidence, continuesTheBuild } from '../src/server/AgentV3/IntentClassifier';
import { writerTaskSiblings, parallelSiblingBrief, readSiblingTasks, SIBLING_TASKS_INPUT_KEY } from '../src/server/AgentV3/parallelSiblings';
import { caseOnlyTwins, caseTwinNote } from '../src/server/AgentV3/caseTwin';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';
import { readyOverrunNote } from '../src/server/AgentV3/doneSignal';
import {
  writeTypecheckCommand, writeTypecheckSummary, emptyWriteTypecheckStats, WRITE_TYPECHECK_NOT_READY_MARKER,
} from '../src/server/AgentV3/writeTimeTypecheck';
import { installedPackageNames, deprecationCommand, deprecationHint } from '../src/server/AgentV3/peerCompatHint';
import { mixedScriptWriteNote } from '../src/server/AgentV3/scriptIntegrity';
import { etaTaskKey } from '../src/server/AgentV3/etaHistory';
import { toolCallTarget } from '../src/server/AgentV3/toolCallTarget';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PROMPT = readFileSync(join(__dirname, 'fixtures', 'autopsySurTaal.prompt.txt'), 'utf8');
const REPORT_CONTINUE = 'Continue the build from where it left off and finish the remaining steps.';

describe('our own Continue sentences resume the work they were made to resume', () => {
  it('the verbatim sentence the "Continue building" card sent is a continuation', () => {
    expect(CONTINUE_INTERRUPTED_BUILD_PROMPT).toBe(REPORT_CONTINUE);
    expect(isPlatformContinuePrompt(REPORT_CONTINUE)).toBe(true);
    expect(isContinuationMessage(REPORT_CONTINUE)).toBe(true);
  });

  it('every platform continue sentence advances a paused plan and is never read as a new app', () => {
    for (const p of [CONTINUE_INTERRUPTED_BUILD_PROMPT, CONTINUE_PAST_BUDGET_PROMPT, CONTINUE_AND_FIX_BUILD_PROMPT]) {
      expect(isContinuationMessage(p), p).toBe(true);
      const v = classifyIntentWithConfidence(p);
      expect(v.intent, p).toBe('edit_existing');
      expect(v.signal, p).toBe('continuation');
    }
  });

  it('a hand-typed "continue the build" is a continuation; one that names something new is not', () => {
    expect(continuesTheBuild('continue the build')).toBe(true);
    expect(continuesTheBuild('please resume my build')).toBe(true);
    expect(continuesTheBuild('continue the build of a new todo app')).toBe(false);
    expect(classifyIntentWithConfidence('build a notes app').intent).toBe('new_build');
    // A real instruction after "continue" is answered, not steamrolled into "build module N".
    expect(isContinuationMessage('continue and add dark mode')).toBe(false);
    expect(isContinuationMessage('continue')).toBe(true);
  });

  it('the client sends the shared constants, never a private copy of the sentence', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).not.toContain(`'${REPORT_CONTINUE}'`);
    expect(panel).not.toContain("'Continue from where you left off and finish/fix the build so the app works end-to-end.'");
    expect(panel).toContain('CONTINUE_INTERRUPTED_BUILD_PROMPT');
    expect(panel).toContain('CONTINUE_AND_FIX_BUILD_PROMPT');
  });
});

describe('parallel specialists are told what the others are building', () => {
  const tu = (role: string, instruction: string) => ({ name: 'task', input: { role, instruction } });
  const isWriter = (r: string) => r === 'frontend' || r === 'backend';

  it('four frontend tasks in one turn each see the other three', () => {
    const uses = [tu('frontend', 'Home'), tu('frontend', 'Now Playing'), tu('frontend', 'Settings'), tu('frontend', 'Equalizer')];
    const sib = writerTaskSiblings(uses, [0, 1, 2, 3], isWriter);
    expect(sib.get(0)?.map((s) => s.instruction)).toEqual(['Now Playing', 'Settings', 'Equalizer']);
    const brief = parallelSiblingBrief(sib.get(0)!);
    expect(brief).toContain('4 specialists');
    expect(brief).toContain('Build ONLY your own task');
    expect(brief).toMatch(/icons\.tsx.*Icons\.tsx/);
  });

  it('a lone writer, or reviewers beside it, get nothing', () => {
    expect(writerTaskSiblings([tu('frontend', 'x'), tu('reviewer', 'y'), tu('qa', 'z')], [0, 1, 2], isWriter).size).toBe(0);
    expect(parallelSiblingBrief([])).toBe('');
    expect(readSiblingTasks({ [SIBLING_TASKS_INPUT_KEY]: 'junk' })).toEqual([]);
    expect(readSiblingTasks({ [SIBLING_TASKS_INPUT_KEY]: [{ role: 'frontend', instruction: 'a' }, { role: 1 }] })).toHaveLength(1);
  });

  it('the runner hands the siblings to the task call, and the task tool appends the brief', () => {
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('writerTaskSiblings(turn.toolUses, parallelIdx');
    expect(runner).toContain('[SIBLING_TASKS_INPUT_KEY]: sib');
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('parallelSiblingBrief(readSiblingTasks(input))');
    expect(read('src/server/AgentV3/systemPrompt.ts')).toContain('Screens that SHARE pieces are not independent');
  });

  it('a delegation shows its role in the report', () => {
    expect(toolCallTarget({ role: 'frontend', instruction: 'build home' })).toBe('frontend (10 chars)');
  });

  it('icons.tsx beside Icons.tsx is named while the file is open', () => {
    expect(caseOnlyTwins('src/components/icons.tsx', ['Icons.tsx', 'Modal.tsx', 'icons.tsx'])).toEqual(['src/components/Icons.tsx']);
    expect(caseOnlyTwins('src/components/Icons.tsx', ['icons.ts'])).toEqual(['src/components/icons.ts']);
    expect(caseOnlyTwins('src/components/Icon.tsx', ['Icons.tsx'])).toEqual([]);
    expect(caseOnlyTwins('src/a.png', ['A.png'])).toEqual([]);
    expect(caseTwinNote('src/components/icons.tsx', ['src/components/Icons.tsx'])).toContain('differ only in letter case');
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('shadow += await this.caseTwinNoteFor(p);');
  });
});

describe('formats are not services', () => {
  it('WAV, AAC and FLAC are file formats', () => {
    expect(unknownNamesInRequest(PROMPT)).toEqual([]);
    expect(unknownNamesInRequest('Supported: WAV, FLAC, OGG, WEBP, DOCX')).toEqual([]);
    expect(unknownNamesInRequest('Connect the app to COACT')).toEqual(['COACT']);
  });

});

describe('the report tells the truth about module turns, stops and write-time checks', () => {
  it('a module turn is "not measured", never "never judged finished"', () => {
    expect(readyOverrunNote(null, 5, 1000, { projectModule: 'Shared Types' })).toContain('one project module ("Shared Types")');
    expect(readyOverrunNote(null, 5, 1000)).toBe('The app was never judged finished during the build.');
  });

  it('a module the user stopped goes back to pending with a paused line, not "failed"', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("const interruptedModule = !result.ok && abort.signal.aborted && interruptedBeforeAnyVerdict(abortCauseOf(abort.signal));");
    expect(route).toContain("markModuleStatus(projectPlanRef, projectModuleRef.id, 'pending')");
    expect(route).toContain('was stopped before it finished');
  });

  it('the write-time check never waits for an install, and says so when it stood down', () => {
    const cmd = writeTypecheckCommand();
    expect(cmd).toContain(WRITE_TYPECHECK_NOT_READY_MARKER);
    expect(cmd.indexOf(WRITE_TYPECHECK_NOT_READY_MARKER)).toBeLessThan(cmd.indexOf('--noEmit'));
    const s = { ...emptyWriteTypecheckStats(), skipped: 1, skippedNotReady: 1 };
    expect(writeTypecheckSummary(s, true, 1)).toContain('dependencies were still being installed');
    const t = { ...emptyWriteTypecheckStats(), timeouts: 1 };
    expect(writeTypecheckSummary(t, true, 1)).toContain('timed out');
    expect(writeTypecheckSummary(t, true, 1)).not.toContain('not TypeScript');
  });

  it('a deprecated package is named at install time', () => {
    expect(installedPackageNames('npm install music-metadata-browser@^2.5.10 --save 2>&1 | tail -30')).toEqual(['music-metadata-browser']);
    expect(installedPackageNames('npm i -D @types/node vite@5')).toEqual(['@types/node', 'vite']);
    expect(deprecationCommand(['music-metadata-browser'])).toContain('npm view "music-metadata-browser" deprecated');
    const hint = deprecationHint("NBAI_DEPRECATED music-metadata-browser This package has been deprecated in favor of music-metadata \nNBAI_DEPRECATED react ");
    expect(hint).toContain('music-metadata-browser is deprecated');
    expect(hint).not.toContain('react is');
    expect(deprecationHint('NBAI_DEPRECATED react ')).toBeNull();
  });

  it('"अरijit" is named while the file is open', () => {
    expect(mixedScriptWriteNote('src/data/demo.ts', 'export const a = { artist: "अरijit" };')).toContain('अरijit');
    expect(mixedScriptWriteNote('src/data/demo.ts', 'export const a = { artist: "अरिजीत" };')).toBe('');
  });

  it('the ETA prices the build the complexity router opened, not the scorer\'s unread guess', () => {
    expect(etaTaskKey('simple_app', false, true)).toBe('complex_app');
    expect(etaTaskKey('simple_app', false, false)).toBe('simple_app');
    expect(etaTaskKey('debugging', false, true)).toBe('debugging');
  });
});
