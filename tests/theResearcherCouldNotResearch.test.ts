// The Researcher could not research (autopsy `31dc61fd`, 2026-09-20).
//
// 🔴 THE DEFECT. The `researcher` role advertises `best approach`, `framework choice` and `search`,
// and its own system prompt says *"find the best approach BEFORE code is written"* — yet it was given
// `READONLY_TOOLS`: `read_file`, `grep`, `glob`, `recall`, `evaluate`. Every one of those reads the
// CURRENT WORKSPACE. So the agent whose job is to decide things before any code exists could only
// look at code that did not exist yet.
//
// What it cost, verbatim from the report: the architect spawned it to study two competitor apps, and
// it spent a model call and 13 seconds replying *"I don't have a web-browsing or screenshot tool
// available in this environment (no `browser_action`, `http`, or live-URL access)"*. The architect
// then did it itself with six `browser_action` calls, the loop-detector fired (*"a repeated step
// that isn't making progress"*), and the very next thing the build did was declare the app complete
// with an EMPTY workspace.
//
// 🔑 THE RULE: a sub-agent must be able to do the job its capabilities advertise. Spawning one that
// can only report its own incapacity is a model call bought to learn nothing — and the fault is in
// the registry, not in the architect that believed it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REGISTRY = readFileSync(join(__dirname, '..', 'src/server/AgentV3/AgentRegistry.ts'), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/** The `tools:` expression for a role, read out of the registry source. */
function toolsFor(role: string): string {
  const code = codeOnly(REGISTRY);
  const at = code.indexOf(`role: '${role}'`);
  expect(at, `role ${role} not found`).toBeGreaterThan(-1);
  const slice = code.slice(at, at + 900);
  const m = slice.match(/tools:\s*([^\n]+)/);
  expect(m, `no tools for ${role}`).toBeTruthy();
  return m![1];
}

describe('🔴 an agent must be able to do the job it advertises', () => {
  it('the researcher can look something up', () => {
    expect(toolsFor('researcher')).toContain('web_search');
  });

  it('it is still READ-ONLY — research never writes files', () => {
    // The fix buys it a lookup, not a licence to edit. Any write tool here would silently turn a
    // knowledge-layer agent into a builder.
    const tools = toolsFor('researcher');
    for (const write of ['write_file', 'edit_file', 'write_files_batch', 'replace_symbol', 'bash']) {
      expect(tools).not.toContain(write);
    }
    expect(tools).toContain('READONLY_TOOLS');
  });
});

describe('🔒 the blast radius is exactly one role', () => {
  it('READONLY_TOOLS itself did NOT gain a web budget', () => {
    // `accessibility` and `reviewer` share that constant. Neither should acquire the ability to
    // search the web as a side effect of fixing the researcher — that would be a cost change to
    // roles nobody examined.
    const code = codeOnly(REGISTRY);
    const m = code.match(/const READONLY_TOOLS: ToolName\[\] = \[([^\]]*)\]/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toContain('web_search');
  });

  it('the other two READONLY roles are unchanged', () => {
    for (const role of ['accessibility', 'reviewer']) {
      expect(toolsFor(role)).not.toContain('web_search');
    }
  });

  it('🔒 web_search is a real registered tool, not a name that resolves to nothing', () => {
    // A tool named in the registry but absent from the catalogue would be a silent no-op — the
    // agent would be told it has a capability and find nothing there, which is the bug being fixed.
    const catalogue = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolCatalog.ts'), 'utf8');
    expect(catalogue).toContain("name: 'web_search'");
  });
});
