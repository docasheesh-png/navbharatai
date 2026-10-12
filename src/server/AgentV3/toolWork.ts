// AgentV3 — DID THIS TOOL CALL PRODUCE WORK? Every tool is classified, explicitly, in one place.
//
// 🔴 WHY (autopsy 9c612cdb, 2026-10-12, Q-945 — the part of 2b0a3ed5 that fix missed). `builtSomethingNow()`
// decides whether a stopped or timed-out build tells the user "Your files so far are saved — send another
// message and I'll continue from here" or "Nothing had been written yet, so nothing was lost". It counted a
// tool call as work unless its name was on a short list of READS (read_file, grep, glob, recall, …). That is
// a deny-list: update_todo, update_preview, typecheck, lint, evaluate, screenshot and every other check or
// bookkeeping tool counted as built work, and so did every NEW read-only tool the day it was added. A fresh
// build stopped after a plan-only turn (the b89ba6f8 shape) told the user their files were saved when not
// one file existed.
//
// So the question is no longer answered by omission. Every tool the platform offers is in EXACTLY ONE of
// `NO_WORK_TOOLS` or the producing side (`PRODUCES_WORK_TOOLS`, or a producing family prefix), and
// `tests/aPlanIsNotBuiltWork.test.ts` fails CI when a catalog tool is in neither — a new tool must be
// classified on purpose before it can ship.
//
// ⚖️ A NAME WE CANNOT CLASSIFY COUNTS AS WORK. That is only ever a tool from outside the catalog (a service
// the user connected, whose effects we cannot see). The opposite lie — "nothing had been written" over a
// change that was made — would be the worse one, and the census keeps every built-in tool out of this branch.
//
// A LEAF — no imports.

/**
 * Tools that write no file, run no command with a lasting effect and spawn no writer: reads, searches,
 * checks, analyses, the plan, the preview and the browser. "Checks" that heal something of the PLATFORM's
 * own as a side effect (evaluate's .gitignore, update_preview's dev-secret file) are still not the app being
 * built.
 */
export const NO_WORK_TOOLS: ReadonlySet<string> = new Set([
  // reads and searches
  'read_file', 'grep', 'glob', 'recall', 'web_search', 'web_fetch', 'read_guide', 'load_tools', 'object_spec',
  // asking another model — an answer, not a change
  'second_opinion', 'consensus',
  // the plan, the preview, the stop
  'update_todo', 'update_preview', 'stop_build',
  // checks and analyses (they report; they do not change the app)
  'evaluate', 'typecheck', 'lint', 'run_tests', 'code_graph', 'architecture_map', 'api_graph', 'schema_graph',
  'find_dead_code', 'find_code_smells', 'check_package', 'check_toolchain', 'check_conventions',
  'scan_vulnerabilities', 'check_licenses', 'threat_model', 'analyze_requirements', 'analyze_service_split',
  'optimize_infra',
  // the running app, looked at and driven — the files stay as they were
  'screenshot', 'console_errors', 'find_ui_element', 'browser_action',
]);

/**
 * Tools that write files, run a command, change the app's database or deployment, or spawn a sub-agent.
 * `task` is listed for the census; the runner still reads its ROLE (a review-only specialist produces none).
 */
export const PRODUCES_WORK_TOOLS: ReadonlySet<string> = new Set([
  'write_file', 'edit_file', 'write_files_batch', 'append_file', 'replace_symbol', 'bash', 'run_recipe',
  'manage_dependency', 'run_migrations', 'setup_architecture', 'repair_ci_workflow', 'request_secrets',
  'deploy', 'task',
]);

/** Families whose every member writes code into the app (`generate_auth`, `codemod_rename`, …). */
export const PRODUCES_WORK_PREFIXES: readonly string[] = ['generate_', 'codemod_'];

/** Which side of the line a tool name is on. 'unclassified' = not a platform tool we know. PURE. */
export function toolWorkClass(name: string): 'produces' | 'none' | 'unclassified' {
  const n = String(name ?? '');
  if (NO_WORK_TOOLS.has(n)) return 'none';
  if (PRODUCES_WORK_TOOLS.has(n) || PRODUCES_WORK_PREFIXES.some((p) => n.startsWith(p))) return 'produces';
  return 'unclassified';
}

/** Could a call to this tool have produced work? Only a tool KNOWN to produce none answers no. PURE. */
export function toolNameCouldProduceWork(name: string): boolean {
  return toolWorkClass(name) !== 'none';
}
