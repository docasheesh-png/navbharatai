// BUILD PHASE — THE LAST SCRATCH SWEEP, AFTER EVERY PASS THAT CAN WRITE (build report #2566).
//
// The scratch-copy net (scratchCopies.ts) ran once, right after the build loop — BEFORE the preview-render repair,
// the runtime auto-fix, the reviewer repair and the rest. In #2566 the preview-render repair wrote `probe.test.ts`
// at ~1190 s, long after that net had run, so no net could see it and it shipped. This is the same sweep, again,
// at the end of the turn and before the durable save, plus the probe net (scratchProbes.ts). Both nets only touch
// files THIS build created that were not in the project when the turn began, and both are idempotent, so running
// the scratch-copy net a second time removes only what a later pass made. Never on an import turn. Never throws.
import { applyScratchCopyNet, type ScratchCopyNetDeps } from '../scratchCopies';
import { applyScratchProbeNet } from '../scratchProbes';

export interface TurnEndScratchReport {
  record(issue: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }): void;
}

export async function sweepScratchAtTurnEnd(input: {
  importTurn: boolean;
  dispatcher: ScratchCopyNetDeps;
  run: (command: string) => Promise<{ stdout?: string } | null>;
  report: TurnEndScratchReport;
  request: string;
  existedAtStart: readonly string[];
  env?: NodeJS.ProcessEnv;
}): Promise<string[]> {
  if (input.importTurn) return [];
  const env = input.env ?? process.env;
  const d = input.dispatcher;
  const ports = {
    listProjectFiles: () => d.listProjectFiles(),
    writtenThisBuild: () => d.writtenThisBuild(),
    removeLeftoverFiles: (ps: readonly string[]) => d.removeLeftoverFiles(ps),
  };
  const removed: string[] = [];
  try {
    removed.push(...await applyScratchCopyNet({ ...ports, mentionedOutside: (p, t) => d.mentionedOutside(p, t) }, input.report, { request: input.request, existedAtStart: input.existedAtStart }, env));
  } catch { /* each net is best-effort on its own */ }
  try {
    removed.push(...await applyScratchProbeNet({ ...ports, runCommand: (c) => input.run(c) }, input.report, { request: input.request, existedAtStart: input.existedAtStart }, env));
  } catch { /* each net is best-effort on its own */ }
  return removed;
}
