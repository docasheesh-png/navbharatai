/**
 * EVERY WRITE A TOOL MAKES REACHES THE SAVED PROJECT (autopsy 1389f0d5, 2026-09-30).
 *
 * The build's durable save starts from a sandbox scan and then lets the writes captured through
 * `onFileWrite` WIN ("freshest, reliable"). That is only true if every write is captured. It was
 * not: `replace_symbol` wrote `src/App.tsx` to the sandbox and never reported it, so the save kept
 * the EARLIER captured copy. Every browser check had looked at the new file; the user's saved
 * project, their GitHub push and the preview copy got the old one (`SAVED_SOURCE_DIVERGES`,
 * `PREVIEW_SNAPSHOT_STALE`). About 170 other tool writes in the dispatcher (the generators, recipes,
 * release notes, the .gitignore heal) had the same gap — harmless only while nothing had captured
 * the same path earlier.
 *
 * So the rule is enforced at the one door every write passes, not at 170 call sites: the
 * dispatcher's actuator is wrapped, each write it makes is noted, and a write the call site did not
 * record itself is recorded at the end of the tool call. A call site that records its own write
 * (most of them, sometimes with transformed content) is left exactly as it was — the note is dropped
 * the moment it records, so nothing is reported twice.
 */

import { isSecretEnvPath, SANDBOX_WORKSPACE_ROOT, toWorkspaceRelPath } from '../lib/workspacePath';
import { isPlatformScratchPath } from '../lib/generatedDirs';
import { currentToolSignal, lapsedGuardEnabled, LAPSED_WRITE_MESSAGE } from './toolDeadline';

export interface WritablePort {
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
}

/**
 * Wrap `inner` so every successful `writeFile` into `workspaceId` is passed to `onWritten`.
 * A write that throws (refused, sandbox gone) is not reported. Every other member is forwarded
 * unchanged, including optional ones the port may lack.
 */
export function recordingActuator<T extends WritablePort>(
  inner: T,
  workspaceId: string,
  onWritten: (path: string, content: string) => void,
  beforeWrite?: (path: string) => void,
): T {
  const refuseIfLapsed = (): void => {
    if (!lapsedGuardEnabled()) return;
    if (currentToolSignal()?.aborted) throw new Error(LAPSED_WRITE_MESSAGE);
  };
  const writeFile = async (ws: string, filePath: string, content: string): Promise<void> => {
    refuseIfLapsed();
    if (beforeWrite) beforeWrite(filePath);
    await inner.writeFile(ws, filePath, content);
    if (ws === workspaceId && !isNotTheProject(filePath)) {
      try { onWritten(filePath, content); } catch { /* recording must never fail a write */ }
    }
  };
  const runCommand = async (ws: string, command: string, ...rest: unknown[]): Promise<unknown> => {
    refuseIfLapsed();
    const fn = (inner as unknown as { runCommand: (ws: string, command: string, ...rest: unknown[]) => Promise<unknown> }).runCommand;
    return fn.call(inner, ws, command, ...rest);
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'writeFile') return writeFile;
      if (prop === 'createFileExclusive' && typeof (target as {createFileExclusive?:unknown}).createFileExclusive === 'function') return async (ws:string,filePath:string,content:string):Promise<void> => {
        refuseIfLapsed();
        beforeWrite?.(filePath);
        await (target as unknown as {createFileExclusive(ws:string,p:string,c:string):Promise<void>}).createFileExclusive(ws,filePath,content);
        if(ws===workspaceId&&!isNotTheProject(filePath)){try{onWritten(filePath,content);}catch{/* recording must never fail a completed write */}}
      };
      if (prop === 'compareAndSwapFile' && typeof (target as {compareAndSwapFile?:unknown}).compareAndSwapFile === 'function') return async (ws:string,filePath:string,expected:string,content:string):Promise<void> => {
        refuseIfLapsed();
        beforeWrite?.(filePath);
        await (target as unknown as {compareAndSwapFile(ws:string,p:string,expected:string,c:string):Promise<void>}).compareAndSwapFile(ws,filePath,expected,content);
        if(ws===workspaceId&&!isNotTheProject(filePath)){try{onWritten(filePath,content);}catch{/* recording must never fail a completed write */}}
      };
      if (prop === 'runCommand' && typeof (target as { runCommand?: unknown }).runCommand === 'function') return runCommand;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * A write that stays in the sandbox and must not be noted for the durable save: a vault env file, or one of
 * NavBharatAI's own temporary files (failedbr #2496 — the asset proof's script was noted here, saved into the
 * user's project, and graded as their code; see `isPlatformScratchPath`).
 */
function isNotTheProject(filePath: string): boolean {
  let rel: string;
  try {
    rel = toWorkspaceRelPath(filePath, SANDBOX_WORKSPACE_ROOT);
  } catch {
    rel = String(filePath ?? '');
  }
  return isSecretEnvPath(rel) || isPlatformScratchPath(rel);
}
