// AgentV3 — A FAILED BUILD THAT RENDERED STILL LEAVES A COPY (admin 2026-11-17, layer 1 of "a preview is never
// blank": "iska koi permanent solution dhundo … han bilkul banao").
//
// Build 3 of a battle royale ended ENGINE_UNAVAILABLE after changing files — and after its app had rendered in a
// real browser. The VM-free copy (previewSnapshot.ts) is taken only inside the production-build gate, which runs
// for a SUCCESSFUL turn. So no copy was taken, the copy from the build before became "not current", and three
// days later the preview had nothing it was allowed to show.
//
// What a copy needs is a working app and a passing production build, not a successful turn. The caller asks
// only when this turn proved the app renders (previewGreen); this runs the SAME production build and, only if
// it passes, takes the SAME copy. It changes no verdict, no outcome and no charge — it is the gate's snapshot
// half, never its judgement — and it reports what it did either way.
//
// Lives outside agentv3.ts on purpose: the build function there is at TypeScript's control-flow-analysis size
// limit (TS2563), so new logic goes in a module and the route keeps a one-line call.

import { buildScriptFrom, judgeProdBuild, prodBuildCommand, PROD_BUILD_TIMEOUT_MS } from './prodBuildGate';
import { loadWorkspaceFiles } from './WorkspaceFileStore';
import { withTimeout } from './asyncUtils';
import { FirebaseHostingDeployer } from './Deployment';
import { withPreviewAiRelay } from './previewBridge';
import { collectWorkspaceFiles } from './WorkspaceFiles';
import { sandboxStore } from './SandboxStore';
import { previewSnapshotEnabled, snapshotChannelId, snapshotSuitable } from './previewSnapshot';
import { fileContentHashes, identitySource, workspaceContentHash, type SnapshotTaken } from './snapshotIdentity';

export interface FailedBuildCopyActuator {
  readFile(workspaceId: string, path: string): Promise<string>;
  runCommand?(workspaceId: string, command: string): Promise<{ exitCode?: number | null; stdout?: string; stderr?: string }>;
  downloadDistFiles?: unknown;
}

export interface FailedBuildCopyRecord {
  phase: 'readiness'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean;
}

export interface FailedBuildTurn {
  ok: boolean;
  /** This turn opened the app in a real browser and saw it render (the route's previewGreen). */
  rendered: boolean;
  /** A copy this turn already took (the gate's), or null. */
  copyTaken: unknown;
  expectsArtifacts: boolean;
  aborted: boolean;
  startedAt: number;
  /** The build's time cap in seconds; 0 = none. */
  maxSeconds: number;
}

/** Only a FAILED turn that rendered, took no copy, was not stopped and has 90 s left. PURE. */
export function failedBuildCopyWanted(t: FailedBuildTurn, now: number): boolean {
  if (t.ok || !t.rendered || t.copyTaken || !t.expectsArtifacts || t.aborted) return false;
  return t.maxSeconds === 0 || now - t.startedAt < t.maxSeconds * 1000 - 90_000;
}

export async function keepFailedBuildCopy(i: {
  actuator: FailedBuildCopyActuator;
  workspaceId: string;
  writtenFiles: ReadonlyMap<string, string>;
  takeCopy: () => Promise<boolean>;
  record: (entry: FailedBuildCopyRecord) => void;
  /** Injected for tests; defaults to the durable store. */
  loadFiles?: (workspaceId: string) => Promise<Record<string, string>>;
  env?: NodeJS.ProcessEnv;
  /** The turn as the route saw it. Decided HERE, so the route's oversized build function gains no branch. */
  turn: FailedBuildTurn;
  now?: number;
}): Promise<boolean> {
  const { actuator, workspaceId } = i;
  if (!failedBuildCopyWanted(i.turn, i.now ?? Date.now())) return false;
  if (!previewSnapshotEnabled(i.env) || !actuator.runCommand || !actuator.downloadDistFiles) return false;
  try {
    const pkgRaw = await actuator.readFile(workspaceId, 'package.json').catch(() => undefined);
    if (!buildScriptFrom(pkgRaw)) return false;
    const stored = await (i.loadFiles ?? loadWorkspaceFiles)(workspaceId).catch(() => ({} as Record<string, string>));
    // A full-stack app's server lived in the sandbox: a static copy would be its shell only — skipped, as in the gate.
    if (!snapshotSuitable(pkgRaw, { ...stored, ...Object.fromEntries(i.writtenFiles) })) return false;
    const command = prodBuildCommand('$(command -v timeout >/dev/null 2>&1 && echo "timeout -k 5 170") npm run build');
    const r = await withTimeout(actuator.runCommand(workspaceId, command), PROD_BUILD_TIMEOUT_MS, 'failed-build-copy');
    const built = judgeProdBuild({ ran: true, exitCode: typeof r.exitCode === 'number' ? r.exitCode : null, output: `${r.stdout || ''}\n${r.stderr || ''}` });
    const kept = built.ok ? await i.takeCopy() : false;
    i.record({
      phase: 'readiness', severity: kept ? 'info' : 'warning',
      code: kept ? 'FAILED_BUILD_COPY_KEPT' : 'FAILED_BUILD_COPY_NOT_KEPT',
      message: kept
        ? 'This build did not finish, but its app rendered and its production build passed — a copy was kept, so the preview has this version to show later.'
        : `This build did not finish and no copy of it was kept (${built.ok ? 'the copy could not be saved' : 'its production build did not pass'}); the preview falls back to the previous copy, labelled as older.`,
      autoResolved: true,
    });
    return kept;
  } catch { return false; /* a fallback copy must never be able to affect the build it is copying */ }
}

/**
 * TAKE THE COPY — moved here verbatim from agentv3.ts (2026-11-17) so the failed-build path and the gate share
 * one definition and the route's build function stays under TypeScript's size limit. Downloads `dist/`, puts it
 * on the snapshot channel (never the publish one), records what source it was built from, and returns that
 * record for the final durable save to confirm. Null when no copy was kept. Never throws.
 */
export async function takeBuildCopy(i: {
  actuator: Parameters<typeof collectWorkspaceFiles>[0] & {
    downloadDistFiles?: (workspaceId: string) => Promise<Map<string, Buffer | string> | null | undefined>;
    noteSnapshotCurrent?: (workspaceId: string, current: boolean) => void;
  };
  workspaceId: string;
  record: (entry: FailedBuildCopyRecord) => void;
}): Promise<SnapshotTaken | null> {
  const { actuator, workspaceId } = i;
  if (!actuator.downloadDistFiles) return null;
  try {
    const dist = await withTimeout(actuator.downloadDistFiles(workspaceId), 60_000, 'snapshot-dist');
    if (!dist || dist.size === 0) return null;
    const url = await withTimeout(
      new FirebaseHostingDeployer().deployStatic(workspaceId, withPreviewAiRelay(dist as never), snapshotChannelId(workspaceId)),
      90_000, 'snapshot-deploy',
    );
    if (!url) return null;
    const at = Date.now();
    // WHAT THE COPY WAS BUILT FROM. Read now, from the same tree `npm run build` just consumed — nothing writes
    // between the two. The final durable save compares this with what it persists; a copy whose source could not
    // be read is never promoted.
    const source = await withTimeout(collectWorkspaceFiles(actuator, workspaceId), 15_000, 'snapshot-identity')
      .then((c) => c.files as Record<string, string>).catch(() => null);
    // The SANDBOX copy of index.html carries our preview bridge once a dev server has run; the durable copy never
    // does. Hash the APP, not our console mirror (autopsy Study-Racer, 2026-09-25).
    const filesHash = source ? workspaceContentHash(identitySource(source)) : null;
    await sandboxStore.saveSnapshot(workspaceId, url, at, filesHash).catch(() => {});
    // THE COPY IS CURRENT, AND THE SURFACE SHOULD KNOW NOW (sandboxLifetime.ts). The actuator clears the flag by
    // itself on the next write, so a later pass that changes a file cannot leave a stale copy counted as current.
    try { actuator.noteSnapshotCurrent?.(workspaceId, true); } catch { /* advisory */ }
    // The `snapshot` event is emitted at the FINAL durable save, once the copy is proven to match what was persisted.
    i.record({
      phase: 'readiness', severity: 'info', code: 'PREVIEW_SNAPSHOT_SAVED',
      message: 'Kept a permanent copy of this build, so the preview still works after its live server expires.',
      autoResolved: true,
    });
    return { url, filesHash, filePaths: source ? Object.keys(identitySource(source)) : undefined, fileHashes: source ? fileContentHashes(identitySource(source)) : undefined };
  } catch { return null; /* a fallback copy must never be able to affect the build it is copying */ }
}
