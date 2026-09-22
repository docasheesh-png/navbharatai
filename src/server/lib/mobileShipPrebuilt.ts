// THE APP IS BUILT HERE; GITHUB ONLY PACKAGES IT (admin 2026-09-22: *"toote hi na" wala banao*).
//
// 🔴 WHY. The GitHub runner's `npm run build` was where most phone builds died — on an app that had
// ALREADY built and rendered in its own sandbox minutes earlier, in front of the user. The whole
// repair loop, the three attempts, the five-minute rounds: nearly all of it existed to recover from a
// compile step that had nothing new to discover. So the compile moves to where the app already lives.
// This module runs the app's PRODUCTION build in its sandbox, reads the output out, and hands it to
// the assembler to ship as `www/` with the static no-op build script. The runner then meets an app it
// cannot fail to compile, because it does not compile it.
//
// 🔒 IT IS AN OPTIMISATION WITH AN HONEST FALLBACK, never a new way to be blocked. Every outcome that is
// not "here is the built app" (the flag is off, the app is static anyway, the sandbox could not be
// reached, the output could not be read, the output is too large) hands the ship back to today's
// source path, which the runner builds exactly as before. Only ONE outcome refuses: the app's own build
// FAILED here in a way the runner would fail too — and that refusal is the same 422 the ship-time check
// already sends, because a five-minute run to learn the same thing is the cost this whole change removes.
//
// ⚠️ THIS PATH WAKES A PAUSED SANDBOX AND SEEDS AN EMPTY ONE — the opposite of `runRealBuildCheck`'s
// "never starts a machine" rule, and deliberately so. That rule was written for an OPPORTUNISTIC check
// beside a ship that would proceed either way; this IS the ship's build. A resume costs seconds and a
// few paise; a GitHub run that fails costs five minutes and one of the user's three attempts. The
// admin chose this trade ("apka pura effort lagao … toote hi na"). A fresh machine that must be
// re-seeded from the durable store and re-installed is the expensive case, and it is bounded by the
// same budget as everything else here — past it, the source ship proceeds.
//
// 🔒 THE OUTPUT IS READ WITH `downloadDistFiles`, THE ONE READER THIS PLATFORM ALREADY HAS. It walks
// the framework's real output directory (`buildOutputCandidates`), carries every file — images and
// fonts included — through a temp file rather than the 64 KB stdout the sandbox caps, and ALREADY
// strips NavBharatAI's preview bridge from every HTML document (`stripBridgeFromBuiltFile`). A second
// reader here would be the drifted-copy class this repository has paid for four times, and the one
// bug it would reintroduce is the worst: 18 KB of our own debug code inside the user's published app.
//
// 🔒 A STALE OUTPUT IS NEVER SHIPPED. The reader takes the FIRST non-empty candidate directory, so a
// `dist/` left by an earlier build in the same machine would be read even if this build wrote nowhere.
// Every candidate directory is removed BEFORE the build runs, so what the reader finds afterwards is
// what THIS build produced — or nothing, which is an honest fallback to the source ship.

import { workspaceContentHash } from '../AgentV3/snapshotIdentity';
import { ensureWorkspaceFilesInSandbox } from '../AgentV3/sandboxSeed';
import { buildOutputCandidates } from '../AgentV3/builtSiteCheck';
import { detectProjectKind, detectWebDir, isBinaryPath, type PrebuiltWeb } from './mobileProjectAssembler';
import { readRealBuildFailure, sandboxHoldsApp } from './mobileShipRealBuild';
import { envFlag } from './envFlag';
import { shellQuote } from './shellQuote';

/** Kill switch. Unset means ON. `off` restores the source ship for every app, exactly as before. */
export function prebuiltShipEnabled(): boolean {
  return envFlag('MOBILE_SHIP_PREBUILT', true);
}

/**
 * How long the production build plus the read-out may take before the source ship proceeds instead.
 * A malformed value takes the default, never "no limit" — the unbounded direction is the bug.
 */
export function prebuiltBudgetMs(): number {
  const raw = Number(process.env.MOBILE_SHIP_PREBUILT_MS);
  if (!Number.isFinite(raw) || raw < 30_000) return 240_000;
  return Math.min(raw, 600_000);
}

/** Past this, the built app goes to the runner as source rather than as ~hundreds of API blobs. */
export const PREBUILT_MAX_BYTES = 40 * 1024 * 1024;
export const PREBUILT_MAX_FILES = 600;
/**
 * A text file above this rides to GitHub as a blob, not inline in the tree request. `commitFiles` puts
 * every inline text file into ONE `POST /git/trees` body; a hashed bundle can be a megabyte on its own,
 * and several of them in one JSON body is the request most likely to fail. A blob is by sha, and the
 * tree API does not care that a "binary" blob is really JavaScript.
 */
export const PREBUILT_INLINE_TEXT_MAX = 200 * 1024;

/** Just enough of the actuator, so a test needs no sandbox and no E2B key. */
export interface PrebuiltActuator {
  /**
   * PRESENCE is the signal that this actuator is backed by a real, resumable machine: `E2BActuator`
   * has it, the local and Docker actuators do not. The RETURN is not consulted — a paused machine is
   * exactly the one this path is allowed to wake. Without the method there is nothing to wake or seed,
   * so the source ship proceeds (and a test's real `LocalActuator` never runs a build on disk).
   */
  hasLiveSandbox?(workspaceId: string): boolean;
  readFile(workspaceId: string, filePath: string): Promise<string>;
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  listFiles(workspaceId: string): Promise<string[]>;
  build(workspaceId: string): Promise<{ success: boolean; logs: string }>;
  runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  downloadDistFiles(workspaceId: string): Promise<Map<string, Buffer>>;
  /** Marks the build for the idle sweep, so a four-minute production build is never paused mid-way. */
  setBuildActive?(workspaceId: string, active: boolean): void;
}

export type PrebuiltSkip =
  | 'flag-off'
  | 'static-app'
  | 'no-sandbox'
  | 'unavailable'
  | 'timed-out'
  | 'no-output'
  | 'too-large';

export type PrebuiltOutcome =
  /**
   * Ship the source, exactly as before. `reason` is for the admin record, never a user sentence.
   * `buildRan` says whether the app's build was STARTED here — a caller must not start a second one.
   */
  | { kind: 'skip'; reason: PrebuiltSkip; buildRan: boolean; log?: string }
  /** The app's own build FAILED here in a way the runner would fail too. Refuse, as the check does. */
  | { kind: 'refuse'; code: string; summary: string; log: string }
  /** Here is the built app. */
  | { kind: 'built'; prebuilt: PrebuiltWeb; outputDir: string; fileCount: number; bytes: number; log: string };

async function raced<T>(work: Promise<T>, budgetMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const clock = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), budgetMs); });
  try {
    return await Promise.race([work, clock]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Does the app declare Vite? The runner's own type-only rescue is `npx vite build`; ours mirrors it. */
export function declaresVite(files: Record<string, string>): boolean {
  try {
    const pkg = JSON.parse(files['package.json'] || '{}') as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return Boolean(pkg.dependencies?.vite || pkg.devDependencies?.vite);
  } catch {
    return false;
  }
}

/**
 * Split the reader's bytes into what the assembler ships as text and what it ships as base64.
 * PURE. The list of binary extensions is the assembler's own (`isBinaryPath`), so the two cannot drift;
 * a LARGE text file also goes as base64 — see `PREBUILT_INLINE_TEXT_MAX`.
 */
export function splitBuiltOutput(dist: ReadonlyMap<string, Buffer>): { files: Record<string, string>; binaryFiles: Record<string, string>; bytes: number } {
  const files: Record<string, string> = {};
  const binaryFiles: Record<string, string> = {};
  let bytes = 0;
  for (const [path, buf] of dist) {
    const rel = String(path).replace(/^\.?\//, '');
    if (!rel || rel.includes('..') || rel.startsWith('/')) continue;
    bytes += buf.length;
    if (isBinaryPath(rel) || buf.length > PREBUILT_INLINE_TEXT_MAX) binaryFiles[rel] = buf.toString('base64');
    else files[rel] = buf.toString('utf8');
  }
  return { files, binaryFiles, bytes };
}

/** The stamp the repository carries at `www/.nbai-prebuilt`. Says WHAT was built, never who. */
export function prebuiltStamp(sourceFiles: Record<string, string>, outputDir: string, fileCount: number, atMs = Date.now()): string {
  return [
    'This folder is the app, built by NavBharatAI before it was pushed. The runner packages it as-is.',
    `built-from: ${workspaceContentHash(sourceFiles)}`,
    `output-dir: ${outputDir}`,
    `files: ${fileCount}`,
    `built-at: ${new Date(atMs).toISOString()}`,
    'To rebuild, press the build button in NavBharatAI again — do not edit these files by hand.',
    '',
  ].join('\n');
}

const PLUGIN_MARKER = 'NBAI_CAP_PLUGINS ';

/**
 * The command that asks the machine which of the app's dependencies are Capacitor plugins — the ONLY
 * packages the runner still needs installed once the app is shipped built.
 *
 * Authoritative, not guessed: a plugin is a package whose OWN package.json carries a `capacitor` field
 * (that is how `cap sync` finds native code), plus the `@capacitor/*` family and Cordova plugins, which
 * Capacitor also wires. Read from `node_modules`, where the app's build just installed them.
 */
export function capacitorPluginScanCommand(): string {
  const js = [
    'const fs=require("fs");',
    'let p={};try{p=JSON.parse(fs.readFileSync("package.json","utf8"))}catch(e){}',
    'const deps=Object.assign({},p.dependencies||{},p.devDependencies||{});',
    'const out=[];',
    'for(const n of Object.keys(deps)){',
    '  if(/^@capacitor\\//.test(n)||/cordova/i.test(n)){out.push(n);continue}',
    '  try{const m=JSON.parse(fs.readFileSync("node_modules/"+n+"/package.json","utf8"));if(m&&m.capacitor)out.push(n)}catch(e){}',
    '}',
    `console.log(${JSON.stringify(PLUGIN_MARKER)}+JSON.stringify(out));`,
  ].join('');
  return `node -e ${shellQuote(js)}`;
}

/** Read the scan's answer. `null` when the machine did not answer in contract — then nothing is trimmed. */
export function parseCapacitorPluginScan(stdout: string): string[] | null {
  const line = String(stdout || '').split('\n').map((l) => l.trim()).find((l) => l.startsWith(PLUGIN_MARKER));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(PLUGIN_MARKER.length)) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((n): n is string => typeof n === 'string' && /^(@[a-z0-9-]+\/)?[a-z0-9._-]+$/i.test(n)).slice(0, 60);
  } catch {
    return null;
  }
}

/** `rm -rf` of every directory the reader would look in — quoted, because one of them comes from the user's own config. */
export function clearOutputDirsCommand(files: Record<string, string>): string {
  const dirs = buildOutputCandidates(files).filter((d) => d && !d.startsWith('/') && !d.includes('..'));
  return `rm -rf ${dirs.map((d) => shellQuote(d)).join(' ')}`;
}

/**
 * Run the app's production build in its own sandbox and read the output out.
 *
 * `files` is the workspace as it will be shipped (after the pre-flight heal); `changed` is what the
 * heal changed — the sandbox already holds everything else, because that is where the app was built.
 */
export async function prebuildForShip(
  actuator: PrebuiltActuator | null | undefined,
  workspaceId: string,
  files: Record<string, string>,
  changed: Record<string, string> = {},
  budgetMs: number = prebuiltBudgetMs(),
): Promise<PrebuiltOutcome> {
  const skip = (reason: PrebuiltSkip, buildRan: boolean, log?: string): PrebuiltOutcome =>
    ({ kind: 'skip', reason, buildRan, ...(log ? { log: log.slice(-6000) } : {}) });

  if (!prebuiltShipEnabled()) return skip('flag-off', false);
  if (!actuator || !workspaceId) return skip('unavailable', false);
  if (typeof actuator.hasLiveSandbox !== 'function') return skip('no-sandbox', false);
  if (detectProjectKind(files) === 'static') return skip('static-app', false);
  const started = Date.now();
  const left = (): number => Math.max(1_000, budgetMs - (Date.now() - started));

  // The machine must hold the app before its build means anything: `build()` says success for a machine
  // with no package.json. Seed an empty one from the durable store — publish's own path — then ask again.
  if (!(await sandboxHoldsApp(actuator, workspaceId))) {
    await raced(ensureWorkspaceFilesInSandbox(actuator, workspaceId), left()).catch(() => null);
    if (!(await sandboxHoldsApp(actuator, workspaceId))) return skip('no-sandbox', false);
  }

  try {
    for (const [path, content] of Object.entries(changed)) await actuator.writeFile(workspaceId, path, content);
  } catch {
    return skip('unavailable', false);
  }

  // Never a stale output — see the header. Best-effort: a machine that cannot even remove a directory
  // will not build either, and that failure is the honest one to report.
  await actuator.runCommand(workspaceId, clearOutputDirsCommand(files)).catch(() => undefined);

  actuator.setBuildActive?.(workspaceId, true);
  let result: { success: boolean; logs: string } | null;
  try {
    result = await raced(actuator.build(workspaceId), left());
  } catch {
    actuator.setBuildActive?.(workspaceId, false);
    return skip('unavailable', true);
  }
  if (!result) {
    // The command keeps running in the machine; the flag is cleared when this request lets go of it.
    actuator.setBuildActive?.(workspaceId, false);
    return skip('timed-out', true);
  }

  let log = String(result.logs || '');
  try {
    if (!result.success) {
      const read = readRealBuildFailure(log);
      // The runner rescues a TYPE-ONLY failure by running the bundler directly, and so do we — the same
      // command, so a pass here means the same thing it would mean there. If even that fails, the runner
      // would fail too, and saying so now is the whole point.
      if (!read.blocking && declaresVite(files)) {
        let direct: { exitCode: number; stdout: string; stderr: string } | null;
        try {
          direct = await raced(actuator.runCommand(workspaceId, 'npx vite build'), left());
        } catch {
          return skip('unavailable', true, log);
        }
        if (!direct) return skip('timed-out', true, log);
        log = `${log}\n--- npx vite build ---\n${direct.stdout}${direct.stderr}`;
        if (direct.exitCode !== 0) {
          const again = readRealBuildFailure(`${direct.stdout}${direct.stderr}`);
          return { kind: 'refuse', code: again.code, summary: again.summary, log: log.slice(-6000) };
        }
      } else if (read.blocking) {
        return { kind: 'refuse', code: read.code, summary: read.summary, log: log.slice(-6000) };
      } else {
        // Type-only, and no Vite to rescue with: the runner has no rescue for it either. Its strict
        // script failing is not a broken app, though — the source ship carries it exactly as today.
        return skip('unavailable', true, log);
      }
    }

    let dist: Map<string, Buffer> | null;
    try {
      dist = await raced(actuator.downloadDistFiles(workspaceId), Math.min(left(), 120_000));
    } catch {
      return skip('no-output', true, log);
    }
    if (!dist) return skip('timed-out', true, log);
    if (dist.size === 0) return skip('no-output', true, log);
    if (dist.size > PREBUILT_MAX_FILES) return skip('too-large', true);

    const split = splitBuiltOutput(dist);
    if (split.bytes > PREBUILT_MAX_BYTES) return skip('too-large', true);
    // Capacitor opens `www/index.html` and nothing else. An output whose page is nested (a bundler that
    // writes `dist/app/index.html` behind a config the reader did not understand) is not shippable as it
    // is — and the source ship, where the runner's own G17b scan repoints the config, still is.
    if (!Object.keys(split.files).some((p) => /^index\.html?$/i.test(p))) return skip('no-output', true, log);

    // Which dependencies the runner still needs: only the Capacitor plugins. Everything else is baked
    // into the bundle, and a dependency the runner does not install is a dependency it cannot fail on.
    // `null` (the machine did not answer) means nothing is trimmed — the safe direction.
    let pluginDeps: string[] | null = null;
    try {
      const scan = await raced(actuator.runCommand(workspaceId, capacitorPluginScanCommand()), Math.min(left(), 20_000));
      pluginDeps = scan ? parseCapacitorPluginScan(scan.stdout) : null;
    } catch {
      pluginDeps = null;
    }

    const outputDir = detectWebDir(files, 'built');
    const fileCount = Object.keys(split.files).length + Object.keys(split.binaryFiles).length;
    return {
      kind: 'built',
      prebuilt: {
        files: split.files,
        binaryFiles: split.binaryFiles,
        stamp: prebuiltStamp(files, outputDir, fileCount),
        pluginDeps,
      },
      outputDir,
      fileCount,
      bytes: split.bytes,
      log: log.slice(-6000),
    };
  } finally {
    actuator.setBuildActive?.(workspaceId, false);
  }
}
