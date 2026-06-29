import { describe, it, expect } from 'vitest';
import { WorkspaceMemory } from '../../src/server/AgentV3/WorkspaceMemory';
import { analyzeArchitecture } from '../../src/server/AgentV3/ArchitectureAnalysis';
import {
  architectSystemPrompt, planSystemPrompt, LANGUAGE_RULE,
} from '../../src/server/AgentV3/systemPrompt';
import { MockAiProvider, applyToolCalls, GOLDEN_CASES } from './aiProviderMock';

/**
 * P-TQA.4 — AI Output / Prompt Regression.
 *
 * Two guards, both deterministic + offline (no real AI call):
 *  1. PROMPT regression — the system prompt must keep carrying the invariants that protect users
 *     (real tools, never-break, working-preview-is-the-goal, prompt-injection defence, language).
 *     A prompt edit that silently drops one of these breaks code-gen quality for everyone.
 *  2. OUTPUT regression — canned "golden" AI responses fed through the REAL evaluation pipeline
 *     (WorkspaceMemory → analyzeArchitecture): good output passes clean; broken output
 *     (hallucinated imports, server-only builtins in the frontend) is caught.
 */

describe('P-TQA.4 — system prompt invariants (regression guard)', () => {
  const architect = architectSystemPrompt();
  const plan = planSystemPrompt();

  it('exposes the real file tools (write_file / edit_file)', () => {
    expect(architect).toContain('write_file');
    expect(architect).toContain('edit_file');
  });

  it('keeps the real-features rule (build the real thing, no fake success)', () => {
    expect(architect).toContain('Build the real thing');
    expect(architect).toContain('No fake success');
  });

  it('keeps the edit-resilience rule so generated apps survive later edits', () => {
    expect(architect).toContain('EDIT-RESILIENT');
    expect(architect).toContain('NEVER BREAK FROM LATER EDITS');
  });

  it('keeps a WORKING PREVIEW as the goal and drives update_preview', () => {
    expect(architect).toContain('WORKING PREVIEW');
    expect(architect).toContain('update_preview');
  });

  it('keeps the prompt-injection defence (external content is data, not instructions)', () => {
    expect(architect).toContain('UNTRUSTED EXTERNAL DATA');
    expect(architect).toContain('exfiltrate');
  });

  it('keeps the language rule (mirror the user, never default to Hindi) in both prompts', () => {
    expect(LANGUAGE_RULE).toContain('MIRROR THE USER');
    expect(architect).toContain('MIRROR THE USER');
    expect(plan).toContain('MIRROR THE USER');
  });

  it('plan prompt plans (todo) without writing files yet', () => {
    expect(plan).toContain('update_todo');
    expect(plan.toLowerCase()).toContain('plan');
  });
});

describe('P-TQA.4 — AI output regression via mock provider', () => {
  const provider = new MockAiProvider(GOLDEN_CASES);

  it('GOOD output: a correct React todo app passes architecture analysis clean', () => {
    const mem = new WorkspaceMemory();
    applyToolCalls(mem, provider.respond('build a React todo app'));
    const report = analyzeArchitecture(mem.graph());

    expect(report.unresolvedImports).toEqual([]);   // every local import resolves
    expect(report.cycles).toEqual([]);              // no import cycles
    expect(report.nodeBuiltinsInFrontend).toEqual([]); // no server-only builtins in UI
    expect(report.layeringViolations).toEqual([]);
  });

  it('GOOD output: key components + the react dependency are detected', () => {
    const mem = new WorkspaceMemory();
    applyToolCalls(mem, provider.respond('build a React todo app'));
    const graph = mem.graph();

    expect(graph.components).toContain('App');
    expect(graph.components).toContain('TodoList');
    expect(graph.dependencies).toContain('react');
  });

  it('BAD output: a hallucinated local import is caught', () => {
    const mem = new WorkspaceMemory();
    applyToolCalls(mem, provider.respond('build an app (broken output)'));
    const report = analyzeArchitecture(mem.graph());

    expect(report.unresolvedImports.length).toBeGreaterThan(0);
    expect(report.unresolvedImports.join(' ')).toContain('DoesNotExist');
  });

  it('BAD output: a server-only builtin (fs) imported into frontend code is caught', () => {
    const mem = new WorkspaceMemory();
    applyToolCalls(mem, provider.respond('build an app (broken output)'));
    const report = analyzeArchitecture(mem.graph());

    expect(report.nodeBuiltinsInFrontend.length).toBeGreaterThan(0);
    expect(report.nodeBuiltinsInFrontend.join(' ')).toContain('fs');
  });

  it('an unknown prompt yields no tool calls (mock is deterministic)', () => {
    expect(provider.respond('something not in the golden set')).toEqual([]);
  });
});
