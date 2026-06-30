// P-DEV.3 — breakpoint state (pure, dependency-free, unit-tested).
//
// The Debugger panel's breakpoints are a map of file path → sorted line numbers, persisted to
// localStorage. These helpers are the single source of truth for toggling, (de)serialising and
// listing them — kept pure so they're testable and the React component stays thin. The live-pause
// half of a debugger (CDP over the cloud sandbox) is honestly deferred; these breakpoints are real,
// persist across refreshes, and will be consumed once live pause ships.

export type BreakpointMap = Record<string, number[]>;

export const BREAKPOINTS_STORAGE_KEY = 'nbai:breakpoints';

/** Toggle a breakpoint at file:line. Returns a NEW map (sorted lines; empty files pruned). Pure. */
export function toggleBreakpoint(map: BreakpointMap, file: string, line: number): BreakpointMap {
  if (!file || !Number.isInteger(line) || line < 1) return map;
  const lines = Array.isArray(map[file]) ? map[file] : [];
  const has = lines.includes(line);
  const next = has ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b);
  const out: BreakpointMap = { ...map };
  if (next.length === 0) delete out[file];
  else out[file] = next;
  return out;
}

/** Remove all breakpoints in one file. Returns a NEW map. Pure. */
export function clearFileBreakpoints(map: BreakpointMap, file: string): BreakpointMap {
  if (!map[file]) return map;
  const out = { ...map };
  delete out[file];
  return out;
}

/** Flatten the map into a stable, sorted list of {file, line}. Pure. */
export function breakpointList(map: BreakpointMap): Array<{ file: string; line: number }> {
  const out: Array<{ file: string; line: number }> = [];
  for (const file of Object.keys(map).sort()) {
    const lines = Array.isArray(map[file]) ? map[file] : [];
    for (const line of [...lines].sort((a, b) => a - b)) out.push({ file, line });
  }
  return out;
}

/** Total breakpoint count. Pure. */
export function breakpointCount(map: BreakpointMap): number {
  let n = 0;
  for (const k of Object.keys(map)) n += Array.isArray(map[k]) ? map[k].length : 0;
  return n;
}

/** Parse a persisted JSON blob into a validated BreakpointMap. Never throws. */
export function loadBreakpoints(raw: string | null | undefined): BreakpointMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: BreakpointMap = {};
    for (const [file, lines] of Object.entries(parsed)) {
      if (typeof file !== 'string' || !file) continue;
      if (!Array.isArray(lines)) continue;
      const clean = Array.from(
        new Set(lines.filter((l): l is number => Number.isInteger(l) && (l as number) >= 1)),
      ).sort((a, b) => a - b);
      if (clean.length > 0) out[file] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Serialise a BreakpointMap for persistence. Pure. */
export function serializeBreakpoints(map: BreakpointMap): string {
  return JSON.stringify(map);
}
