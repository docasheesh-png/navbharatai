import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG_TOOL_NAMES } from './ToolCatalog';

// Regression guard for the second absolute rule (real features only — no advertised-but-unwired tools).
// Every tool name the model is offered (CATALOG_TOOL_NAMES / ToolCatalog) MUST actually route to real
// handling in ToolDispatcher — otherwise the model can call a tool that falls straight through to the
// "Unknown tool" error, i.e. an advertised capability that silently does nothing. This test reads the
// dispatcher source and asserts each catalog tool is routed by ONE of the two real mechanisms:
//   1. a switch `case '<name>':` in the main dispatch, OR
//   2. the dedicated browser-tools branch (`call.name === '<name>'`) for screenshot / browser_action.
// A new tool added to the catalog without a handler fails CI here instead of shipping broken.
const DISPATCHER_SRC = readFileSync(
  fileURLToPath(new URL('./ToolDispatcher.ts', import.meta.url)),
  'utf8',
);

function isRouted(name: string): boolean {
  return (
    DISPATCHER_SRC.includes(`case '${name}'`) ||
    DISPATCHER_SRC.includes(`call.name === '${name}'`) ||
    DISPATCHER_SRC.includes(`name === '${name}'`)
  );
}

describe('tool wiring — every advertised tool is dispatchable (rule 2)', () => {
  it('has at least the full known catalog (sanity: the list was actually loaded)', () => {
    expect(CATALOG_TOOL_NAMES.length).toBeGreaterThan(50);
  });

  it('every CATALOG_TOOL_NAMES entry routes to a real handler (no advertised-but-unwired tool)', () => {
    const unrouted = CATALOG_TOOL_NAMES.filter((n) => !isRouted(n));
    expect(unrouted, `Advertised but NOT wired in ToolDispatcher: ${unrouted.join(', ')}`).toEqual([]);
  });

  it('the routing detector is real — a made-up tool name is correctly seen as unrouted', () => {
    expect(isRouted('definitely_not_a_real_tool_xyz')).toBe(false);
  });
});
