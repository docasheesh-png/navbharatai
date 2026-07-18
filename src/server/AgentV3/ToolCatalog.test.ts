import { describe, it, expect } from 'vitest';
import { defaultToolCatalog, catalogForTools, CATALOG_TOOL_NAMES } from './ToolCatalog';
import { dedupeToolsByName, type ClaudeToolDef } from './ClaudeClient';
import { roleConfig } from './AgentRegistry';

// Deep-test 2026-07-18: a drifted DUPLICATE `typecheck` tool def made the Anthropic API reject the whole
// `tools` array with a HARD 400 ("tools: Tool names must be unique.") — it killed a finished build's Claude
// heal pass and cascaded the entire provider-fallback chain (VERTEX → GEMINI → CLAUDE_HAIKU). GLM/Kimi
// tolerate duplicates; Anthropic does not. These lock the uniqueness invariant at every layer.
describe('tool-name uniqueness invariant (build-killer 400 guard)', () => {
  it('defaultToolCatalog() has NO duplicate tool names', () => {
    const names = defaultToolCatalog().map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `duplicate tool defs: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
  });

  it('the CATALOG_TOOL_NAMES allow-list has no duplicate names', () => {
    const names = CATALOG_TOOL_NAMES as unknown as string[];
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `duplicate names: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
  });

  it('catalogForTools() returns unique names even if the allowed list repeats one', () => {
    const defs = catalogForTools(['read_file', 'typecheck', 'typecheck', 'bash'] as never);
    const names = defs.map((d) => d.name);
    expect(names.filter((n) => n === 'typecheck')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it("the architect's real tool set assembles with no duplicate names (the exact failing path)", () => {
    const names = catalogForTools(roleConfig('architect').tools).map((d) => d.name);
    expect(new Set(names).size, 'architect tools must be unique or Anthropic 400s the build').toBe(names.length);
    expect(names).toContain('typecheck'); // still present exactly once
  });

  it('dedupeToolsByName keeps the FIRST occurrence and drops later same-name defs', () => {
    const mk = (name: string, description: string): ClaudeToolDef => ({ name, description, input_schema: { type: 'object', properties: {} } });
    const out = dedupeToolsByName([mk('a', 'first'), mk('b', 'x'), mk('a', 'second'), mk('a', 'third')]);
    expect(out.map((t) => t.name)).toEqual(['a', 'b']);
    expect(out.find((t) => t.name === 'a')?.description).toBe('first');
  });
});
