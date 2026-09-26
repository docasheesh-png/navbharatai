import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { SALVAGE_HANDOFF_MARKER, HANDOFF_MECHANICAL_FIX_RULE, HANDOFF_NOTE_FIX_LINE } from '../src/server/AgentV3/handoffRule';
import { decideUnfinishedResume } from '../src/server/AgentV3/unfinishedResume';

/**
 * Autopsy 121c2431 (admin approved the narrow exception, 2026-09-26). The system prompt said
 * "MANDATORY DELEGATION (no exceptions) … never write application code yourself" while the fast-lane
 * hand-off note said "fix any error in place". The architect fixed one import, then argued with itself
 * for 26,371 characters about which instruction it had broken, and stopped. The two now say one thing.
 */
describe('the architect may fix mechanical errors in files a faster lane handed over', () => {
  const prompt = architectSystemPrompt('vite-react');

  it('🔴 the prompt no longer claims "no exceptions" while the hand-off asks for one', () => {
    expect(prompt).not.toMatch(/MANDATORY DELEGATION \(no exceptions\)/);
    expect(prompt).toMatch(/MANDATORY DELEGATION \(one narrow exception, below\)/);
  });

  it('the exception is keyed to the exact marker the hand-off note carries', () => {
    expect(prompt).toContain(`when the request opens with ${SALVAGE_HANDOFF_MARKER}`);
    for (const line of HANDOFF_MECHANICAL_FIX_RULE) expect(prompt).toContain(line);
  });

  it('it is narrow: mechanical fixes only — features, components and pages are still delegated', () => {
    const rule = HANDOFF_MECHANICAL_FIX_RULE.join(' ');
    expect(rule).toMatch(/import/);
    expect(rule).toMatch(/New features, new components and new pages are still delegated/);
    expect(HANDOFF_NOTE_FIX_LINE).toMatch(/New features, components and pages still go to the specialists/);
    // The rest of the delegation rule is untouched.
    expect(prompt).toContain('src/components/**, src/pages/**, src/hooks/**, src/ui/** → task(frontend)');
    expect(prompt).toContain('You (Architect) write ONLY: package.json');
  });

  it('the hand-off note is built from the same constants — the marker and the fix line cannot drift', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toContain('`${SALVAGE_HANDOFF_MARKER} A faster build lane already generated');
    expect(src).toContain('fix any error in place. ${HANDOFF_NOTE_FIX_LINE}');
    expect(src).not.toContain('`[CONTINUE — DO NOT START OVER] A faster build lane');
  });

  it('the resume message offers the same two routes, not a third wording', () => {
    const d = decideUnfinishedResume({ text: 'Plan: fix it.', blockers: ['1 unresolved import(s)'], resumesUsed: 0 });
    expect(d.message).toMatch(/task\(\)/);
    expect(d.message).toMatch(/MECHANICAL fixes \(imports, types, props, names, paths\) yourself with edit_file/);
  });
});
