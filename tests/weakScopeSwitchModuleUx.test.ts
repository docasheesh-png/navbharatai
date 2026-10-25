import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { weakAdmissionReply, weakAdmissionCode } from '../src/server/AgentV3/weakBuildAdmission';
import {
  WEAK_SCOPE_STRONG,
  WEAK_SCOPE_UNAVAILABLE,
  isWeakScopeGuidanceCode,
  weakScopeGuidanceCard,
} from '../src/lib/weakScopeGuidance';

const panel = readFileSync(resolve('src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
const reducer = readFileSync(resolve('src/components/agentv3/agentV3Reducer.ts'), 'utf8');

describe('Weak scope Switch module UX', () => {
  it('exposes structured codes the panel can act on', () => {
    expect(weakAdmissionCode('strong')).toBe(WEAK_SCOPE_STRONG);
    expect(weakAdmissionCode(null)).toBe(WEAK_SCOPE_UNAVAILABLE);
    expect(isWeakScopeGuidanceCode(WEAK_SCOPE_STRONG)).toBe(true);
  });

  it('card copy is calm product guidance, not a failure strip', () => {
    const strong = weakScopeGuidanceCard(WEAK_SCOPE_STRONG);
    expect(strong.title).toMatch(/stronger module/i);
    expect(strong.hint).toContain('Nothing was charged');
    expect(strong.body.toLowerCase()).not.toMatch(/fail|error|fix with ai/);
    const unavailable = weakScopeGuidanceCard(WEAK_SCOPE_UNAVAILABLE);
    expect(unavailable.title).toMatch(/choose a module/i);
    expect(unavailable.hint).toContain('Nothing was charged');
  });

  it('panel opens Build options via Switch module and never offers Fix with AI for those codes', () => {
    expect(panel).toContain('isWeakScopeGuidanceCode(state.resultCode)');
    expect(panel).toContain('weakScopeGuidanceCard(state.resultCode)');
    expect(panel).toContain('setSettingsOpen(true)');
    expect(panel).toContain('setHighlightPowerPicker(true)');
    expect(panel).toContain('data-build-options-trigger');
    expect(panel).toContain('data-power-picker');
    expect(panel).toContain('Switch module');
    const start = panel.indexOf('isWeakScopeGuidanceCode(state.resultCode)');
    const end = panel.indexOf(') : (', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const guidanceBranch = panel.slice(start, end);
    expect(guidanceBranch).toContain('Switch module');
    expect(guidanceBranch).toContain('openModulePicker');
    expect(guidanceBranch).not.toContain('fixWithAI(');
    expect(guidanceBranch).not.toContain('CONTINUE_AND_FIX_BUILD_PROMPT');
    expect(guidanceBranch).not.toContain('bg-amber-500/10');
    // Ordinary broken builds still keep Fix with AI.
    expect(panel).toContain('fixWithAI(CONTINUE_AND_FIX_BUILD_PROMPT)');
  });

  it('reducer stores result.code as resultCode for done and result events', () => {
    expect(reducer).toContain('resultCode: event.code');
  });

  it('guidance copy stays calm and points at Build options', () => {
    for (const scope of ['strong', null] as const) {
      const text = weakAdmissionReply(scope);
      expect(text).toContain('Switch module');
      expect(text).toContain('Build options');
      expect(text).toContain('Nothing was charged');
      expect(text.toLowerCase()).not.toMatch(/fix with ai|beyond the weak tier/);
    }
  });
});
