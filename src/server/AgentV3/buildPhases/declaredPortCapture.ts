// BUILD PHASE: capture the port the app says it serves on — moved out of the build route's handler, unchanged in behaviour
// (Q-3237, option A).
//
// WHAT PORT DOES THIS APP SAY IT SERVES ON (declaredPort.ts, admin report 2026-08-24)? Captured on EVERY successful build,
// because the proven-port recipe only exists once a preview has genuinely come up. An app whose preview has never rendered has
// no recipe at all, and that is exactly when the door fell through to a common-ports guess and offered 3000 for an Express app
// serving on 5000. Bounded reads, all best-effort — a port hint must never be able to affect a build.
import { DECLARED_PORT_FILES, declaredPortFrom } from '../declaredPort';
import { withTimeout } from '../asyncUtils';
import type { BuildDiagnostics } from '../BuildDiagnostics';

export async function captureDeclaredPort(io: {
  /** package.json as already read by the caller (undefined when absent). */
  pkgRaw: string | undefined;
  read: (path: string) => Promise<string>;
  save: (port: number) => Promise<unknown>;
  record: BuildDiagnostics['record'];
}): Promise<number | null> {
  try {
    const portFiles: Record<string, string | undefined> = { 'package.json': io.pkgRaw };
    for (const path of DECLARED_PORT_FILES) {
      if (path === 'package.json' || portFiles[path] !== undefined) continue;
      try { portFiles[path] = await withTimeout(io.read(path), 4_000, 'declared-port'); } catch { /* absent is normal */ }
    }
    const declared = declaredPortFrom(portFiles);
    if (!declared) return null;
    await io.save(declared.port).catch(() => {});
    io.record({
      phase: 'preview', severity: 'info', code: 'DECLARED_PORT',
      message: `This app declares it serves on port ${declared.port} (from ${declared.source}). The preview will try that before any common-port guess.`,
      autoResolved: true,
    });
    return declared.port;
  } catch { return null; /* best-effort — never affects the build */ }
}
