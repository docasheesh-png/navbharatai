// AgentV3 — A TOOL'S OUTPUT REDIRECTED INTO A FILE IS SCRATCH, NOT THE USER'S APP (Q-2713, autopsy 57604006).
//
// Build 969740df ran `./node_modules/.bin/tsc --noEmit 2>&1 > typecheck_output.txt`, read it back with `cat`, and the
// platform then adopted `typecheck_output.txt` as a project file: the done line told the user "I changed 2 files in
// your project (src/game/battleroyale/game.ts, typecheck_output.txt)" and the file was saved and published with the
// app. The shell-write ledger is right to read back what a command writes (a missed write loses work); what it lacked
// was the one question "is this the app at all?".
//
// PRECISION FIRST — a user's own `notes.txt` or `CHANGELOG.txt` is their project. Both halves are required: a file
// at the workspace ROOT named like a capture (typecheck/tsc/lint/test/build/errors/output/result/log, .txt/.out/.log)
// AND content that is a tool's output (compiler or test lines) or empty (a clean run writes nothing). PURE.

const CAPTURE_NAME = /^(?:[\w.-]*[-_.])?(?:typecheck|tsc|lint|eslint|tests?|vitest|jest|build|compile|errors?|output|out|results?|log)(?:[-_.][\w.-]*)?\.(?:txt|out|log)$/i;
const TOOL_OUTPUT = /error TS\d{3,5}|\(\d+,\d+\): error|\bTest Files\b|\bTests\s+\d+\s+(?:passed|failed)|✖ \d+ problems?|npm ERR!|ERR_PNPM|\bbuilt in \d|\bvite v\d|^\s*FAIL\s/m;

/** Is this file a captured tool output rather than part of the app? PURE. */
export function isScratchCapture(path: string, content: string | null | undefined): boolean {
  const p = String(path ?? '').replace(/^(?:\.\/)+/, '');
  if (!p || p.includes('/') || !CAPTURE_NAME.test(p)) return false;
  const text = String(content ?? '');
  return text.trim() === '' || TOOL_OUTPUT.test(text.slice(0, 20_000));
}
