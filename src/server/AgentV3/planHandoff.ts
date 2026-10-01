// A PLAN HANDED TO THE FULL BUILDER SAYS WHICH OF ITS FILES ALREADY EXIST (autopsy 1219c639, 2026-10-01).
//
// When the fast lane stops after planning and before writing, its file list is handed to the full builder
// as a head start (autopsy f97eb0ec). The hand-off said, of every planned file, "these files are NOT written
// yet … Nothing below has been created". On that report's continue build the list was src/App.tsx,
// src/main.tsx, src/index.css, index.html, package.json, the three tsconfigs and vite.config.ts — every one of
// them already in the workspace (our starter, plus what the earlier build had installed). The builder
// coped by reading them first, but it was handed a false statement about its own workspace, which is the
// confident-and-wrong instruction that hand-off was written to avoid. PURE.

/** The hand-off text for a plan, naming which planned files the workspace already holds. */
export function planHandoffText(planned: readonly string[], existing: ReadonlySet<string>, entryLine = ''): string {
  const list = planned.slice(0, 40);
  const already = list.filter((p) => existing.has(p));
  const fresh = list.filter((p) => !existing.has(p));
  const head = fresh.length === 0
    ? '[A PLAN ALREADY EXISTS — every file in it is already in the workspace] '
    : already.length === 0
      ? '[A PLAN ALREADY EXISTS — these files are NOT written yet] '
      : '[A PLAN ALREADY EXISTS — some of its files are not written yet] ';
  const parts: string[] = [
    `${head}A faster lane planned THIS app's file list before it ran out of time. This is a starting point, not prior work.`,
  ];
  if (fresh.length > 0) parts.push(`Not created yet:\n${fresh.map((p) => `- ${p}`).join('\n')}`);
  if (already.length > 0) {
    parts.push(`Already in the workspace (the starter or earlier work) — read each before you change it:\n${already.map((p) => `- ${p}`).join('\n')}`);
  }
  parts.push('Use it so you do not spend the budget re-deciding the same structure. You may add, merge or rename a file where the app genuinely needs it — the plan is a head start, not a contract.'
    + (entryLine ? ` ${entryLine}` : ''));
  return parts.join('\n');
}
