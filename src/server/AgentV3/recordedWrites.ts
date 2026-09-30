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
): T {
  const writeFile = async (ws: string, filePath: string, content: string): Promise<void> => {
    await inner.writeFile(ws, filePath, content);
    if (ws === workspaceId) {
      try { onWritten(filePath, content); } catch { /* recording must never fail a write */ }
    }
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'writeFile') return writeFile;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
