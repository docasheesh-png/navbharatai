// Autopsy 3d1bfe2a (2026-10-01) — "Automation AI app" was stopped 8 s in, before a file was written.
// Thirty seconds later "An AI automation app" was built as an EDIT of our own starter ("✏️ Editing your
// existing app (11 source files)"), filed under taskType "chat" with a chat-sized ETA. The stop itself
// was recorded as an LLM_CALL_FAILED error and a fast-lane BUILD_FAILED; the second build's setup line
// reprinted the first build's starter completion and the machine's creation-time restore as its own;
// and the model spent five steps defining `.nb-nav` / `.nb-brand-icon`, which the kit did not carry.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { holdsOnlyOurStarter } from '../src/server/AgentV3/starterFragment';
import { strictTsconfig } from '../src/server/AgentV3/strictTrial';
import { starterTemplates } from '../src/server/AgentV3/ToolDispatcher';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { BUILD_STOPPED_MESSAGE } from '../src/server/AgentV3/stopSignal';
import { stoppedSummary } from '../src/server/AgentV3/SimpleBuilder';
import { setupRestoreText } from '../src/server/routes/agentv3';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';

const read = (p: string) => readFileSync(p, 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('an earlier request counts as a project only if it left one', () => {
  const vite = starterTemplates().find((t) => typeof t['src/App.tsx'] === 'string' && typeof t['package.json'] === 'string')!;
  it('a workspace holding only our starter, byte for byte, holds no app', () => {
    expect(vite).toBeTruthy();
    expect(holdsOnlyOurStarter({ ...vite }, starterTemplates())).toBe(true);
  });
  it('a strict-trial workspace (Q-008, #3446) still holds only our starter', () => {
    expect(holdsOnlyOurStarter({ ...vite, 'tsconfig.json': strictTsconfig(vite['tsconfig.json']) }, starterTemplates())).toBe(true);
  });
  it('one changed file, or one we could not read, is an app', () => {
    expect(holdsOnlyOurStarter({ ...vite, 'src/App.tsx': 'export default function App(){ return <h1>My shop</h1>; }' }, starterTemplates())).toBe(false);
    expect(holdsOnlyOurStarter({ ...vite, 'src/Cart.tsx': 'export const x = 1;' }, starterTemplates())).toBe(false);
    expect(holdsOnlyOurStarter({ ...vite, 'src/App.tsx': null }, starterTemplates())).toBe(false);
  });
  it('the intention reader is told what the workspace really holds', () => {
    const route = strip(read('src/server/routes/agentv3.ts'));
    expect(route).toContain('{ projectExists: earlierRequestLeftAnApp, recentRequests },');
    expect(route).not.toContain('{ projectExists: userAppExists || recentRequests.length > 0, recentRequests },');
    expect(route).toContain('return !holdsOnlyOurStarter(files, starterTemplates());');
  });
  it('a build order read as a build is sized as an app, not as chat', () => {
    expect(analyzeRequest({ prompt: 'An AI automation app', buildIntent: 'new_build' }).taskType).toBe('app_unsized');
  });
});

describe('a stop is not a failure', () => {
  it('a model call cancelled by Stop is recorded as info, never as LLM_CALL_FAILED', () => {
    const d = new BuildDiagnostics();
    d.recordLlmCall({ provider: 'unknown', model: 'unknown', promptChars: 10, responseChars: 0, finishReason: null, toolCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 6, ok: false, error: BUILD_STOPPED_MESSAGE } as never);
    const codes = d.report().issues.map((i) => i.code);
    expect(codes).toContain('LLM_CALL_STOPPED');
    expect(codes).not.toContain('LLM_CALL_FAILED');
    expect(d.report().counts.errors).toBe(0);
  });
  it('the fast lane says what a stop saved, and is not filed as a failed hand-off', () => {
    expect(stoppedSummary(0)).toMatch(/nothing had been written/);
    expect(stoppedSummary(3)).toMatch(/files finished so far are saved/);
    expect(read('src/server/routes/agentv3.ts')).toContain("message: sb.stopped ? 'Fast-lane outcome: stopped by the user");
  });
});

describe('a setup line describes this setup', () => {
  it('a machine that was already up was not restored now', () => {
    expect(setupRestoreText('warm', 'nothing saved yet — nothing to restore')).toMatch(/^n\/a — the machine was already up/);
    expect(setupRestoreText('created-fresh', 'restored 12/12 files')).toBe('restored 12/12 files');
    expect(setupRestoreText(null, null)).toBe('n/a (warm or resumed)');
  });
  it('the starter completion is counted per setup', () => {
    const src = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    const at = src.indexOf('private async _ensureWorkspaceAttempt(');
    expect(src.slice(at, at + 600)).toContain('this._starterCompleted.delete(workspaceId);');
  });
});

describe('the dashboard shell names the classes a model reaches for', () => {
  it('.nb-nav and .nb-brand-icon are in the kit and in the prompt', () => {
    expect(DESIGN_KIT_CSS).toMatch(/\.nb-nav \{/);
    expect(DESIGN_KIT_CSS).toMatch(/\.nb-brand-icon \{/);
    expect(architectSystemPrompt()).toContain('`nav.nb-nav`');
  });
});
