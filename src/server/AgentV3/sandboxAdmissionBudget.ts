import type { IEngineerActuator } from './sandbox/EngineerAI/actuators/IEngineerActuator';
import type { ToolUse } from './ClaudeClient';
import type { ToolResult } from './ToolDispatcher';
import { isE2BConcurrentCapacityError, isE2BConcurrentCapacityMessage } from './e2bConcurrentCapacity';

const SANDBOX_TOOLS = new Set(['bash', 'glob', 'read_file', 'write_file', 'append_file', 'write_files_batch', 'edit_file', 'list_directory', 'grep', 'screenshot', 'browser_action', 'find_ui_element']);
export const SANDBOX_ADMISSION_BLOCKED = 'Workspace admission is still unavailable after a recovery attempt. Stopping this attempt without completing the app; no capacity, quota or machine was changed. Existing files are kept. Try again when workspace capacity is available.';

/** Build-scoped, shared across retry/heal runners. One real recovery after a proven capacity refusal.
 * No negative-cache timer, provider fallback, machine reclamation, or inference from arbitrary output.
 * Pending recovery is a barrier, not a shared tool RESULT: different tools never get another's output.
 */
export function createSandboxAdmissionBudget() {
  let failures = 0;
  let actuatorOwnsAdmission = false;
  let admitted = false;
  let workspaceWriteAcknowledged = false;
  let operationBarrier: Promise<unknown> | null = null;
  let recovery: Promise<ToolResult> | null = null;
  const exhausted = () => failures >= 2;
  const observe = (result: ToolResult): ToolResult => {
    if (result.is_error && isE2BConcurrentCapacityMessage(result.content)) failures++;
    else if (!result.is_error) failures = 0;
    return result;
  };
  const refused = (call: ToolUse): ToolResult => ({ tool_use_id: call.id, is_error: true, content: SANDBOX_ADMISSION_BLOCKED });
  return {
    get exhausted(): boolean { return exhausted(); },
    get workspaceWriteAcknowledged(): boolean { return workspaceWriteAcknowledged; },
    /** Called only after the matching build-local actuator write resolves, not from tool prose. */
    acknowledgeWorkspaceWrite(): void { workspaceWriteAcknowledged = true; },
    /** One owner counts real actuator errors, not the same error again after a tool renders it. */
    useActuatorAdmission(): void { actuatorOwnsAdmission = true; },
    async operation<T>(run: () => Promise<T>): Promise<T> {
      while (operationBarrier) await operationBarrier.catch(() => {});
      if (exhausted()) throw new Error(SANDBOX_ADMISSION_BLOCKED);
      const execute = async (): Promise<T> => {
        try {
          const value = await run(); failures = 0; admitted = true; return value;
        } catch (error) {
          if (isE2BConcurrentCapacityError(error)) { failures++; admitted = false; }
          throw error;
        }
      };
      // Probe once before fan-out. After real admission, independent file operations stay parallel.
      if (admitted) return execute();
      const pending = Promise.resolve().then(execute); operationBarrier = pending;
      try { return await pending; }
      finally { if (operationBarrier === pending) operationBarrier = null; }
    },
    async dispatch(call: ToolUse, run: () => Promise<ToolResult>): Promise<ToolResult> {
      if (!SANDBOX_TOOLS.has(call.name)) return run();
      if (actuatorOwnsAdmission) return exhausted() ? refused(call) : run();
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

/** Build-local only: never wraps the singleton globally, lifecycle operations, another workspace,
 * synchronous observers or durable-store reads. No pause/reap/quota changes and no negative timer.
 */
export const SANDBOX_ADMISSION_OPERATIONS = new Set([
  'ensureWorkspace', 'writeFile', 'writeBinaryFile', 'readFile', 'listFiles', 'build',
  'ensureDependencies', 'runCommand', 'browseUrl', 'getPortUrl', 'scanUiElements',
  'screenshot', 'browserAction', 'getConsoleErrors', 'openPty', 'writePty', 'resizePty',
  'killPty', 'searchFiles', 'checkpoint', 'downloadDistFiles', 'provisionBackend', 'restore',
]);
export function sandboxAdmissionActuator<T extends IEngineerActuator>(actuator: T, workspaceId: string, budget: SandboxAdmissionBudget): T {
  budget.useActuatorAdmission();
  return new Proxy(actuator, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== 'function') return value;
    if (typeof key !== 'string' || !SANDBOX_ADMISSION_OPERATIONS.has(key)) return value.bind(target);
    return (...args: unknown[]) => args[0] === workspaceId
      ? budget.operation(async () => {
        const result = await Reflect.apply(value, target, args);
        if (key === 'writeFile' || key === 'writeBinaryFile') budget.acknowledgeWorkspaceWrite();
        return result;
      })
      : Reflect.apply(value, target, args);
  } });
}
