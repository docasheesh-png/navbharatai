/**
 * PER-VERSION PREVIEW — look at an old checkpoint before you decide to go back to it.
 *
 * ROADMAP §2: "Per-version preview URL — v0 has it." Until now the only way to see what the app
 * looked like three checkpoints ago was `/api/agentv3/restore`, which OVERWRITES the working tree. So
 * the user had to destroy the present to inspect the past, and if the old version turned out to be
 * worse, they had to restore forward again. That is a bad trade to force on someone who just wanted
 * to look.
 *
 * 🔑 WHY THIS COSTS NOTHING EXTRA. The obvious implementation — boot a second sandbox at that commit —
 * would have doubled the E2B bill for a feature nobody uses on every build, on the same day the idle
 * window was cut from 15 to 5 minutes to save ~₹1,500/month. Instead this runs inside the sandbox the
 * user ALREADY has warm: `git worktree` gives a second checkout of the same repository, and E2B exposes
 * every port of one VM as its own hostname (`getPortUrl`). One VM, two servers, two URLs, no new VM.
 *
 * 🔒 WHAT IT REFUSES TO FAKE. Each of these is a DIFFERENT answer, and the user can act on some of them:
 *   • the sandbox is cold        → nothing can be previewed this session; the code is safe, come back.
 *   • the commit is not in git   → this workspace's sandbox was rebuilt from durable files, so the old
 *                                  history is genuinely gone. Restore cannot reach it either.
 *   • the server never came up   → the old version does not RUN (often its dependencies differ from
 *                                  today's). Say so, and clean the worktree up rather than hand back a
 *                                  URL that 502s.
 * A URL is returned only after something actually answers on that port.
 *
 * ⚠️ node_modules is SHARED with the live workspace by symlink, deliberately. Installing a whole second
 * dependency tree per version would cost minutes and disk for a glance, and old lockfiles resolve to
 * packages that may no longer exist. The honest consequence: a version whose dependencies genuinely
 * differ from today's may fail to boot — and that is reported as `server-did-not-start`, not smoothed
 * over. Previewing the CODE of an old version is the promise; resurrecting its exact dependency tree
 * is not, and pretending otherwise would be the fake-success this repo forbids.
 */

import { ensureViteAllowedHosts, isViteConfigPath } from './ViteConfigGuard';
import { devServerCommand, parsePackageJson } from './devScript';
import { shellQuote } from '../lib/shellQuote';

/** Where the live app lives; the worktrees hang off a sibling directory so a build never sees them. */
export const WORKSPACE_ROOT = '/home/user/workspace';
export const VERSIONS_ROOT = '/home/user/.nbai-versions';

/**
 * Ports for version previews. Far above every framework default (3000/4200/5173/8000) so a version
 * preview can never collide with the app's own dev server — a collision would not just fail, it would
 * silently show the user the WRONG version, which is worse than showing nothing.
 */
export const VERSION_PORT_BASE = 5310;
/**
 * How many versions may be live at once, per workspace. Each is a node process in the user's sandbox;
 * unbounded, a curious user could start twenty and exhaust the VM's memory, taking their real build
 * down with it. Opening one past the cap retires the oldest.
 */
export const MAX_LIVE_VERSIONS = 2;

/** How long to wait for an old version's dev server before calling it dead. */
export const START_DEADLINE_MS = 45_000;

export type VersionPreviewReason =
  | 'ok'
  | 'sandbox-cold'
  | 'version-not-in-sandbox'
  | 'worktree-failed'
  | 'server-did-not-start';

export interface VersionPreviewResult {
  ok: boolean;
  reason: VersionPreviewReason;
  /** Only ever set when something really answered on the port. */
  url?: string;
  port?: number;
  sha: string;
  message: string;
}

/** A commit id we are willing to interpolate into a shell command. */
export function isValidSha(sha: unknown): sha is string {
  return typeof sha === 'string' && /^[0-9a-f]{7,40}$/i.test(sha);
}

/** The directory name for a version — short, stable, and safe as a path segment. */
export function versionDir(sha: string): string {
  return `${VERSIONS_ROOT}/${sha.slice(0, 12).toLowerCase()}`;
}

/** The port for the Nth live version preview. */
export function slotPort(slot: number): number {
  return VERSION_PORT_BASE + slot;
}

/** `git worktree` needs the commit to actually be in this sandbox's object store. */
export function shaExistsCommand(sha: string): string {
  return `git -C ${WORKSPACE_ROOT} cat-file -e ${sha}^{commit} 2>/dev/null && echo HAVE_IT`;
}

/**
 * Check out the commit beside the live tree.
 *
 * `--detach` because a version preview is a look, never a branch to commit onto. `--force` because a
 * previous preview of the same sha may have left a registered worktree behind; re-using the directory
 * is correct and cheaper than tearing it down first.
 */
export function worktreeAddCommand(sha: string): string {
  const dir = versionDir(sha);
  return `mkdir -p ${VERSIONS_ROOT} && rm -rf ${dir} && git -C ${WORKSPACE_ROOT} worktree prune && git -C ${WORKSPACE_ROOT} worktree add --detach --force ${dir} ${sha}`;
}

/** Share the live dependency tree — see the header for why this is a symlink and not an install. */
export function linkModulesCommand(sha: string): string {
  return `ln -sfn ${WORKSPACE_ROOT}/node_modules ${versionDir(sha)}/node_modules`;
}

/**
 * Start the old version's dev server, detached, with its output in a file.
 *
 * `setsid` + a redirect to a log file, for the same reason the main dev server uses them: a server
 * still attached to the command's stdio gets SIGPIPE-killed the moment the command returns and it
 * writes its next line — the "vite says ready, then dies" failure this codebase has already paid for
 * once.
 */
export function startVersionServerCommand(sha: string, port: number, command: string): string {
  const dir = versionDir(sha);
  return `cd ${dir} && setsid nohup sh -c ${shellQuote(command)} > ${dir}/.nbai-preview.log 2>&1 < /dev/null & echo STARTED`;
}

/** Does anything answer on the port yet? Any HTTP status counts — even a 500 proves a server is there. */
export function healthCommand(port: number): string {
  return `curl -s -o /dev/null -m 3 -w "%{http_code}" http://127.0.0.1:${port}/ 2>/dev/null || echo 000`;
}

/** A server answered if curl reported any status at all. */
export function isHealthy(stdout: string): boolean {
  const code = String(stdout ?? '').trim().slice(-3);
  return /^[1-5][0-9]{2}$/.test(code);
}

/** Stop one version preview and remove its checkout — a retired version must not keep costing memory. */
export function stopVersionCommand(sha: string, port: number): string {
  const dir = versionDir(sha);
  return `(fuser -k ${port}/tcp 2>/dev/null || true); rm -rf ${dir}; git -C ${WORKSPACE_ROOT} worktree prune 2>/dev/null; echo STOPPED`;
}

/** Read a file out of the sandbox as base64, so no content can break the shell command carrying it. */
export function readFileCommand(path: string): string {
  return `[ -f ${path} ] && base64 -w0 ${path} || echo ''`;
}

/** Write base64 back — the safe half of the same trick. */
export function writeFileCommand(path: string, base64: string): string {
  return `printf '%s' ${shellQuote(base64)} | base64 -d > ${path}`;
}

/** Single-quote for `sh`, closing and reopening around any embedded quote. */
// Re-exported for compatibility — the implementation now lives in `lib/shellQuote.ts`, where it is
// the SINGLE copy for the whole server. There were four identical ones until 2026-08-21, and a
// security primitive with four homes is one hardening away from having a weakest one.
export { shellQuote };

/**
 * WHICH VERSIONS ARE LIVE — asked of the SANDBOX, never of this process's memory.
 *
 * A Map on the server would be wrong the moment Cloud Run served the user's next request from another
 * instance: the map would read empty while the servers were still running, so the slot allocator would
 * hand out a port already bound and the preview would fail with `server-did-not-start` — a lie about
 * the cause. The sandbox is the one place that knows the truth, and it is the same truth from every
 * instance, so each preview stamps its own port and start time into its directory and we read them back.
 */
export function listLiveVersionsCommand(): string {
  return `for d in ${VERSIONS_ROOT}/*/; do [ -f "$d.nbai-port" ] && echo "$(basename $d) $(cat $d.nbai-port) $(cat $d.nbai-started 2>/dev/null || echo 0)"; done 2>/dev/null || true`;
}

export interface LiveVersion { sha: string; port: number; startedAt: number }

/** Parse the listing above; anything malformed is skipped rather than guessed at. */
export function parseLiveVersions(stdout: string): LiveVersion[] {
  const out: LiveVersion[] = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const [sha, port, startedAt] = line.trim().split(/\s+/);
    if (!isValidSha(sha)) continue;
    const p = Number(port);
    if (!Number.isInteger(p) || p < VERSION_PORT_BASE) continue;
    out.push({ sha, port: p, startedAt: Number(startedAt) || 0 });
  }
  return out;
}

/** Stamp the port and start time so any instance can read this preview back. See the note above. */
export function stampVersionCommand(sha: string, port: number): string {
  const dir = versionDir(sha);
  return `echo ${port} > ${dir}/.nbai-port && date +%s000 > ${dir}/.nbai-started && echo STAMPED`;
}

export interface VersionPreviewDeps {
  /** Runs a command in the user's warm sandbox. */
  run: (command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Maps a sandbox port to its public URL. */
  portUrl: (port: number) => Promise<string>;
  /** Whether the sandbox is warm in this session at all. */
  sandboxWarm: () => Promise<boolean>;
  /** Test seam: waits between health polls. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam: the clock the deadline is measured against. */
  now?: () => number;
}

/** The message shown to the user for each outcome — plain, and never blaming them for a cold sandbox. */
export function versionPreviewMessage(reason: VersionPreviewReason): string {
  switch (reason) {
    case 'ok': return 'This version is live — open it to compare, then restore only if you want it back.';
    case 'sandbox-cold': return 'Your build environment is asleep. Open the project and make one change to wake it, then try again.';
    case 'version-not-in-sandbox': return 'That version’s history is not in this environment any more, so it cannot be previewed or restored.';
    case 'worktree-failed': return 'Could not open that version. Your current files were not touched.';
    case 'server-did-not-start': return 'That version did not start — it likely needs different dependencies from your app today. Your current files were not touched.';
  }
}

/**
 * Bring one historical version up and return its URL.
 *
 * Every failure path leaves the LIVE workspace untouched — this only ever adds a sibling directory —
 * and a failure to start cleans that directory up rather than leaving the sandbox to accumulate dead
 * checkouts across a long session.
 */
export async function startVersionPreview(
  sha: string,
  slot: number,
  deps: VersionPreviewDeps,
): Promise<VersionPreviewResult> {
  const fail = (reason: VersionPreviewReason): VersionPreviewResult =>
    ({ ok: false, reason, sha, message: versionPreviewMessage(reason) });

  if (!isValidSha(sha)) return fail('version-not-in-sandbox');
  if (!(await deps.sandboxWarm().catch(() => false))) return fail('sandbox-cold');

  const have = await deps.run(shaExistsCommand(sha)).catch(() => null);
  if (!have || !have.stdout.includes('HAVE_IT')) return fail('version-not-in-sandbox');

  const added = await deps.run(worktreeAddCommand(sha)).catch(() => null);
  if (!added || added.exitCode !== 0) return fail('worktree-failed');
  await deps.run(linkModulesCommand(sha)).catch(() => null);

  const port = slotPort(slot);
  const dir = versionDir(sha);

  // An OLD vite config predates the preview-host guard, so without this the version's URL answers with
  // "Blocked request … is not allowed" — a 403 that looks exactly like a broken app to the user.
  await patchViteConfigForHost(dir, deps).catch(() => undefined);

  const pkgRaw = await readSandboxFile(`${dir}/package.json`, deps).catch(() => '');
  const command = devServerCommand(parsePackageJson(pkgRaw), port);

  // Stamp BEFORE starting: if the process dies between the two, a stale stamp only costs one wasted
  // slot that the next cleanup reclaims, whereas a running server with no stamp is invisible to every
  // other instance and would keep its port bound with nothing able to find or stop it.
  await deps.run(stampVersionCommand(sha, port)).catch(() => null);

  const started = await deps.run(startVersionServerCommand(sha, port, command)).catch(() => null);
  if (!started) { await deps.run(stopVersionCommand(sha, port)).catch(() => null); return fail('worktree-failed'); }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + START_DEADLINE_MS;
  while (now() < deadline) {
    await sleep(1500);
    const health = await deps.run(healthCommand(port)).catch(() => null);
    if (health && isHealthy(health.stdout)) {
      const url = await deps.portUrl(port).catch(() => '');
      if (!url) break;
      return { ok: true, reason: 'ok', url, port, sha, message: versionPreviewMessage('ok') };
    }
  }

  // Never hand back a URL we could not prove; and never leave the dead checkout behind.
  await deps.run(stopVersionCommand(sha, port)).catch(() => null);
  return fail('server-did-not-start');
}

/** Read one sandbox file through the base64 round-trip. Returns '' when it is absent. */
export async function readSandboxFile(path: string, deps: Pick<VersionPreviewDeps, 'run'>): Promise<string> {
  const res = await deps.run(readFileCommand(path)).catch(() => null);
  const b64 = res?.stdout.trim() ?? '';
  if (!b64) return '';
  try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return ''; }
}

/**
 * Give the old checkout's Vite config the same allowed-host treatment the live one gets.
 *
 * Reuses `ensureViteAllowedHosts` rather than re-deriving the patch — that guard is already the single
 * place this repo describes how a Vite config must look to be reachable from an E2B host, and a second
 * opinion here would drift from it the first time E2B changed anything.
 */
export async function patchViteConfigForHost(dir: string, deps: Pick<VersionPreviewDeps, 'run'>): Promise<boolean> {
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.mts', 'vite.config.cts']) {
    if (!isViteConfigPath(name)) continue;
    const current = await readSandboxFile(`${dir}/${name}`, deps);
    if (!current) continue;
    const patched = ensureViteAllowedHosts(name, current);
    if (patched === current) return false;
    const b64 = Buffer.from(patched, 'utf8').toString('base64');
    const res = await deps.run(writeFileCommand(`${dir}/${name}`, b64)).catch(() => null);
    return res?.exitCode === 0;
  }
  return false;
}

/**
 * Which live previews to retire so a new one fits.
 *
 * Oldest-first, because the version a user opened five minutes ago is the one they have stopped
 * looking at. Returns the entries to stop, never mutates the input.
 */
export function versionsToRetire<T extends { sha: string; port: number; startedAt: number }>(
  live: readonly T[],
  incomingSha: string,
  max = MAX_LIVE_VERSIONS,
): T[] {
  const others = live.filter((v) => v.sha.toLowerCase() !== incomingSha.toLowerCase());
  const overBy = others.length - (max - 1);
  if (overBy <= 0) return [];
  return [...others].sort((a, b) => a.startedAt - b.startedAt).slice(0, overBy);
}

/** The lowest free slot, so a retired version's port is immediately reusable. */
export function freeSlot(live: readonly { port: number }[], max = MAX_LIVE_VERSIONS): number {
  const taken = new Set(live.map((v) => v.port));
  for (let i = 0; i < max; i += 1) if (!taken.has(slotPort(i))) return i;
  return 0;
}

/**
 * THE WHOLE SLOT DECISION, in one place: what to stop, and which slot the new preview takes.
 *
 * This used to be three statements inline in the route, and being inline is precisely how it shipped
 * wrong. Re-opening a version that was ALREADY live retired nothing (correctly — it is a refresh), but
 * the slot was then chosen from a list that still counted the old server, so the refresh took a SECOND
 * port while `worktreeAddCommand` deleted the directory out from under the first. The result was an
 * orphan process still bound to the old port, with no directory behind it and no stamp for any
 * instance to find it by — a leak that only showed up on the second tap of the same button.
 *
 * Pure, so the ordering that matters — stop first, THEN choose from what is genuinely still running —
 * is testable instead of implied.
 */
export function planVersionSlot(
  live: readonly LiveVersion[],
  incomingSha: string,
  max = MAX_LIVE_VERSIONS,
): { toStop: LiveVersion[]; slot: number } {
  const key = incomingSha.slice(0, 12).toLowerCase();
  const already = live.find((v) => v.sha.toLowerCase() === key);
  const retire = versionsToRetire(live, incomingSha, max);
  const toStop = already ? [already, ...retire.filter((r) => r.sha !== already.sha)] : retire;
  const stopped = new Set(toStop.map((v) => v.sha));
  return { toStop, slot: freeSlot(live.filter((v) => !stopped.has(v.sha)), max) };
}
