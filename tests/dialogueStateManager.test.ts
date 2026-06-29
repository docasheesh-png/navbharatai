import { describe, it, expect } from 'vitest';
import { inferPhase, phaseGuidance, dialoguePhaseContext } from '../src/server/AgentV3/DialogueStateManager';

/** P-AI.3 — dialogue phase inference (pure). */

describe('DialogueStateManager — inferPhase', () => {
  it('reported failure on an existing project → debugging', () => {
    expect(inferPhase({ intent: 'edit_existing', prompt: 'the login button does nothing', hasExistingFiles: true })).toBe('debugging');
    expect(inferPhase({ intent: 'edit_existing', prompt: 'it crashes with a blank screen', hasExistingFiles: true })).toBe('debugging');
    expect(inferPhase({ intent: 'new_build', prompt: 'still broken, console error', hasExistingFiles: true })).toBe('debugging');
  });

  it('debug words on a brand-new project (no files) are NOT debugging', () => {
    // No project yet → "error" in a fresh ask shouldn't force debugging.
    expect(inferPhase({ intent: 'new_build', prompt: 'build an error-tracking dashboard', hasExistingFiles: false })).not.toBe('debugging');
  });

  it('explicit ship request → deployed', () => {
    expect(inferPhase({ intent: 'edit_existing', prompt: 'deploy it to production', hasExistingFiles: true })).toBe('deployed');
    expect(inferPhase({ intent: 'new_build', prompt: 'publish and go live', hasExistingFiles: false })).toBe('deployed');
  });

  it('editing an established project → building', () => {
    expect(inferPhase({ intent: 'edit_existing', prompt: 'add a dark mode toggle', hasExistingFiles: true })).toBe('building');
    expect(inferPhase({ intent: 'new_build', prompt: 'add a dashboard page', hasExistingFiles: true })).toBe('building');
  });

  it('fresh build in plan mode → planning', () => {
    expect(inferPhase({ intent: 'new_build', prompt: 'build a CRM with contacts and deals', hasExistingFiles: false, planning: true })).toBe('planning');
  });

  it('very short fresh ask → requirements', () => {
    expect(inferPhase({ intent: 'new_build', prompt: 'a todo app', hasExistingFiles: false })).toBe('requirements');
  });

  it('detailed fresh ask (no plan mode) → building', () => {
    expect(inferPhase({ intent: 'new_build', prompt: 'build a recipe app with search, categories, favorites and a shopping list', hasExistingFiles: false })).toBe('building');
  });

  it('chat falls back to requirements', () => {
    expect(inferPhase({ intent: 'chat', prompt: 'hello', hasExistingFiles: false })).toBe('requirements');
  });
});

describe('DialogueStateManager — phaseGuidance', () => {
  it('building returns empty (baseline) to avoid redundant tokens', () => {
    expect(phaseGuidance('building')).toBe('');
  });
  it('other phases return a non-empty posture instruction', () => {
    expect(phaseGuidance('debugging')).toContain('DEBUGGING');
    expect(phaseGuidance('requirements')).toContain('REQUIREMENTS');
    expect(phaseGuidance('planning')).toContain('PLANNING');
    expect(phaseGuidance('deployed')).toContain('DEPLOY');
  });
});

describe('DialogueStateManager — dialoguePhaseContext', () => {
  it('returns phase + guidance together', () => {
    const r = dialoguePhaseContext({ intent: 'edit_existing', prompt: 'it throws an exception', hasExistingFiles: true });
    expect(r.phase).toBe('debugging');
    expect(r.guidance).toContain('DEBUGGING');
  });
  it('building phase yields empty guidance', () => {
    const r = dialoguePhaseContext({ intent: 'edit_existing', prompt: 'tweak the colors', hasExistingFiles: true });
    expect(r.phase).toBe('building');
    expect(r.guidance).toBe('');
  });
});
