/**
 * AUTOPSY 6db0ff31 (2026-09-30) — "A app for my online buisness of digital marketing agency".
 *
 * A free user's first build. The workspace held our starter plus a zero-byte file named `java` they had
 * created in Code Studio. What followed, in order:
 *
 *   1. That file was counted as "1 source file", so the turn was run as an EDIT of an app nobody had
 *      written ("✏️ Editing your existing app (1 source file)"), the request analyser filed the build
 *      under "chat" (score 5), and Software Project Mode declined to plan it.
 *   2. The architect delegated to the Frontend specialist, which was never handed the user's words. It
 *      read the fresh scaffold and replied "What would you like me to build?" — to the architect, since a
 *      specialist cannot reach the user — and wrote nothing. 35 s later the user pressed Stop.
 *   3. The report then graded our starter under "observation about your existing code", recorded
 *      "billed at real cost only ($0.1047)" beside a final bill of ₹0, and filed the stop as an ERROR and
 *      an unresolved warning.
 *
 * Every lock below was proven by reversion (put the bug back, watch it fail).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { userRequestBlock, CHILD_REQUEST_MAX_CHARS } from '../src/server/AgentV3/SubAgent';
import { taskResultWithWrites } from '../src/server/AgentV3/ToolDispatcher';
import {
  couldBeAppCode, isStrayRootName, appSourceFileCount, userOwnedFileCount, workspaceHoldsUserApp,
} from '../src/server/AgentV3/userProjectFiles';
import { projectHasUserCode } from '../src/server/AgentV3/platformAuthored';
import { ViteReactProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProvider';
import { markupWaiverSettledLine } from '../src/server/AgentV3/previewEarnsMarkup';
import { lintBuiltApp } from '../src/server/AgentV3/buildQualityLint';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';

const PROMPT = 'A app for my online buisness of digital marketing agency';
const SPECIALIST_REPLY = 'I see the workspace has a fresh Vite + React scaffold with the design kit already in `src/index.css`. What would you like me to build?';
const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const SUBAGENT = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');

describe('1 · a specialist is handed the user\'s own words', () => {
  it('the block carries the request verbatim and says the specialist cannot reach the user', () => {
    const b = userRequestBlock(PROMPT);
    expect(b).toContain(PROMPT);
    expect(b).toMatch(/cannot talk to the user/);
    expect(b).toMatch(/Never end by asking what to build/);
    // Context, not a second task: the architect's instruction still decides the work.
    expect(b).toMatch(/context for YOUR task below/);
  });
  it('a reviewer (writes nothing) gets the request without the "build it" line', () => {
    const b = userRequestBlock(PROMPT, false);
    expect(b).toContain(PROMPT);
    expect(b).not.toMatch(/Never end by asking/);
  });
  it('nothing to hand ⇒ nothing added; a huge paste is capped', () => {
    expect(userRequestBlock('')).toBe('');
    expect(userRequestBlock(undefined)).toBe('');
    const big = userRequestBlock('x'.repeat(CHILD_REQUEST_MAX_CHARS + 500));
    expect(big).toContain('[request truncated]');
    expect(big.length).toBeLessThan(CHILD_REQUEST_MAX_CHARS + 600);
  });
  it('the spawn puts it into the child\'s context, and the route hands it the prompt', () => {
    const at = SUBAGENT.indexOf('const contextBlocks = [');
    expect(SUBAGENT.slice(at, SUBAGENT.indexOf('].filter(Boolean);', at))).toContain('userRequestBlock(deps.userRequest?.()');
    expect(ROUTE).toContain('userRequest: () => prompt,');
  });
});

describe('2 · a specialist that asked a question asked it of nobody', () => {
  it('🔴 the reported reply is named as a question the user will never see', () => {
    const out = taskResultWithWrites('frontend', { ok: true, summary: SPECIALIST_REPLY, written: [] });
    expect(out).toMatch(/stopped to ask a question/);
    expect(out).toMatch(/cannot reach the user/);
    expect(out).toMatch(/delegate again with an instruction that says exactly what to build/);
  });
  it('a plain empty result keeps the old wording; a result with writes is untouched', () => {
    expect(taskResultWithWrites('frontend', { ok: true, summary: 'Done.', written: [] })).toMatch(/wrote NO files\. Anything the text above/);
    const w = taskResultWithWrites('frontend', { ok: true, summary: 'What next?', written: ['src/App.tsx'] });
    expect(w).toMatch(/files this agent actually wrote \(1\)/);
    expect(w).not.toMatch(/stopped to ask/);
  });
});

describe('3 · a stray root file is not an app', () => {
  it('🔴 the reported `java` file is not app code, and the workspace holds no app of the user\'s', () => {
    expect(isStrayRootName('java')).toBe(true);
    expect(couldBeAppCode('java')).toBe(false);
    expect(appSourceFileCount(['java'])).toBe(0);
    expect(userOwnedFileCount(['java', 'src/App.tsx', 'package.json'])).toBe(0);
    expect(workspaceHoldsUserApp(['java', '.gitignore'])).toBe(false);
  });
  it('real extensionless project files and nested scripts still count', () => {
    for (const p of ['Dockerfile', 'Makefile', 'Procfile', 'Gemfile', 'bin/www', 'scripts/deploy']) {
      expect(couldBeAppCode(p), p).toBe(true);
    }
    expect(couldBeAppCode('.env')).toBe(true);
    expect(couldBeAppCode('README.md')).toBe(true);
  });
  it('an app-protecting count keeps scaffold paths — a one-file app lives in src/App.tsx', () => {
    expect(appSourceFileCount(['src/App.tsx', 'java', 'logo.png'])).toBe(1);
  });
  it('the route: the reader is told whether the USER has an app, and the rebuild guard weighs app code', () => {
    // Since autopsy 3d1bfe2a an earlier request counts only if it left more than our starter.
    expect(ROUTE).toContain('{ projectExists: earlierRequestLeftAnApp, recentRequests }');
    expect(ROUTE).toContain('if (userAppExists || recentRequests.length === 0) return userAppExists || recentRequests.length > 0;');
    expect(ROUTE).not.toContain('{ projectExists, recentRequests }');
    // One count for both guards, corrected only when the saved files are our untouched starter (autopsy 31254f9a).
    expect(ROUTE).toContain('let durableSourceCount = appSourceFileCount(durableFilePaths);');
    expect(ROUTE).not.toContain('countEditableSourceFiles(durableFilePaths)');
    expect(ROUTE).toContain('const sourceCount = appSourceFileCount(fileTree);');
  });
  it('once the build is read as one, the analyser stops filing it under "chat"', () => {
    expect(analyzeRequest({ prompt: PROMPT, buildIntent: 'new_build' } as never).taskType).not.toBe('chat');
  });
});

describe('4 · the report tells one story about a stopped build', () => {
  // The exact starter the reported sandbox held (index.html 290 bytes, a placeholder App.tsx).
  const base = new ViteReactProvider().getFiles([]);
  it('🔴 our untouched sandbox starter plus an empty file is no user code to grade', () => {
    expect(projectHasUserCode(base)).toBe(false);
    expect(projectHasUserCode({ ...base, java: '' })).toBe(false);
    expect(projectHasUserCode({ ...base, 'src/pages/Home.tsx': 'export default () => null;' })).toBe(true);
  });
  it('the design kit itself carries no image — the CSS comment naming <img> is not markup', () => {
    const r = lintBuiltApp({ 'src/index.css': DESIGN_KIT_CSS });
    expect(r?.a11y.violations.some((v) => v.type === 'img-alt')).toBe(false);
  });
  it('the waiver line says when a later rule zeroed the bill', () => {
    const reason = 'The app was never confirmed running here, so the service margin was waived: billed at real cost only ($0.1047 instead of $0.4188).';
    expect(markupWaiverSettledLine(reason, 0.1047)).toBe(reason);
    const zeroed = markupWaiverSettledLine(reason, 0, 'stopped by the user before any file was written — never charged');
    expect(zeroed).toContain('Superseded: the final bill is ₹0 (stopped by the user');
  });
  it('the route records the waiver line only once the bill is settled', () => {
    const settle = ROUTE.indexOf('const markupDecision = decideMarkupOnProof({');
    const released = ROUTE.indexOf('markupWaiverSettledLine(markupDecision.reason, effectiveBilledUsd, zeroBillReason)');
    const zeroRule = ROUTE.indexOf('if (expectsArtifacts && writtenFiles.size === 0) {', settle);
    expect(settle).toBeGreaterThan(-1);
    expect(released).toBeGreaterThan(zeroRule);
  });
  it('a stopped build\'s RED gate is not an error, and its upsell suppression is not a problem', () => {
    expect(ROUTE).toContain("severity: gate.state === 'red' && !result.ok && gateEvidence.stoppedByUser !== true ? 'error'");
    expect(ROUTE).toContain("phase: 'build', severity: stopped ? 'info' : 'warning', code: 'UPSELL_SUPPRESSED', autoResolved: stopped,");
  });
});
