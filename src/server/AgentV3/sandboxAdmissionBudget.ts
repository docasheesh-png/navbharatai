import type { ToolUse } from './ClaudeClient';
import type { ToolResult } from './ToolDispatcher';

const SANDBOX_TOOLS = new Set(['bash', 'glob', 'read_file', 'write_file', 'edit_file', 'list_directory', 'grep', 'screenshot', 'browser_action', 'find_ui_element']);
const CAPACITY = /^(?:Error:\s*)?Rate limit exceeded, please try again later - you have reached the maximum number of concurrent E2B sandboxes \(\d+\)/;
export const SANDBOX_ADMISSION_BLOCKED = 'Workspace admission is still unavailable after a recovery attempt. Stopping this attempt without completing the app; no capacity, quota or machine was changed. Existing files are kept. Try again when workspace capacity is available.';

/** Build-scoped, shared across retry/heal runners. One real recovery after a proven capacity refusal.
 * No negative-cache timer, provider fallback, machine reclamation, or inference from arbitrary output.
 * Pending recovery is a barrier, not a shared tool RESULT: different tools never get another's output.
 */
export function createSandboxAdmissionBudget() {
  let failures = 0;
  let recovery: Promise<ToolResult> | null = null;
  const exhausted = () => failures >= 2;
  const observe = (result: ToolResult): ToolResult => {
    if (result.is_error && CAPACITY.test(result.content)) failures++;
    else if (!result.is_error) failures = 0;
    return result;
  };
  const refused = (call: ToolUse): ToolResult => ({ tool_use_id: call.id, is_error: true, content: SANDBOX_ADMISSION_BLOCKED });
  return {
    get exhausted(): boolean { return exhausted(); },
    async dispatch(call: ToolUse, run: () => Promise<ToolResult>): Promise<ToolResult> {
      if (!SANDBOX_TOOLS.has(call.name)) return run();
      if (recovery) await recovery.catch(() => {});
      if (exhausted()) return refused(call);
      if (!failures) return observe(await run());
      const pending = run().then(observe);
      recovery = pending;
      try { return await pending; }
      finally { if (recovery === pending) recovery = null; }
    },
  };
}
export type SandboxAdmissionBudget = ReturnType<typeof createSandboxAdmissionBudget>;
