// WHAT ACTUALLY STARTED THE DEV SERVER — recorded by the one place that knows (admin 2026-08-21).
//
// The revival recipe (previewRevival.ts) is only worth storing if the command in it is the command
// that REALLY ran. During a build, nobody in the route layer knows that: the dev server is started by
// a tool call the model issued, transformed by the actuator (port pinning, host binding, .env
// sourcing, output redirection), and the route only ever sees a preview URL afterwards.
//
// So the actuator — the single place that both launches the server and observes the port it bound —
// writes the pair here, and the route reads it at the moment the preview is PROVEN to render. That
// keeps one fact in one place instead of re-deriving it at three call sites, which is the drift this
// codebase has paid for before (four copies of safeRelPath, five copies of a model id).
//
// DELIBERATELY IN-PROCESS. This is a hand-off inside a single build, measured in minutes, between two
// modules in the same process — not state to persist. The durable copy is the recipe itself, written
// once the launch is proven. A missing entry (another instance, a restart) therefore yields NO recipe
// rather than a guessed one, which is the whole point: buildRecipe() refuses a partial recipe.

import { isLongRunningCommand, isOneShotSegment } from './sandbox/EngineerAI/actuators/devServerHost';

export interface DevServerLaunch {
  /** The command as handed to the actuator — replaying it re-applies every transformation it does. */
  command: string;
  /** The port the server was observed to be listening on. */
  port: number;
  at: number;
}

/** A launch older than this is not evidence about the server running now. */
const LAUNCH_TTL_MS = 60 * 60 * 1000;

const launches = new Map<string, DevServerLaunch>();

/** A segment that starts a server. */
const SERVER_SEGMENT = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b|\b(npx\s+)?(vite(?!\s+build)|next\s+(dev|start)|serve|http-server|nodemon|tsx|ts-node)\b|\bpython3?\s+(-m\s+http\.server|manage\.py\s+runserver)|\bnode\s+\S+/;
/** A segment that sets up the environment the server needs, so it must be replayed with it. */
const SETUP_SEGMENT = /^(cd\s|export\s|source\s|\.\s|set\s+-a)/;
/** A pipe into a reader that EXITS (head/tail/grep/…) — it can kill a long-running server by SIGPIPE. */
const TRUNCATING_PIPE = /\s*\|\s*(head|tail|grep|sed|awk|cut|less|more)\b.*$/;

/**
 * The part of a command that really starts the server (autopsy "Universal Remote", 2026-09-27).
 *
 * A model ran `: > /tmp/empty.css && echo done && npm run dev -- --host 0.0.0.0 --port 5173 2>&1 |
 * head -40`, and that whole line became the stored REVIVAL recipe — so every later wake-up would
 * truncate an empty temp file, echo "done", and pipe the dev server into `head -40`, which exits after
 * 40 lines and can take the server down with SIGPIPE. The recipe is replayed for the life of the app, so
 * noise in it is permanent. Keep the environment set-up (`cd`, `export`, `source`), the server itself,
 * and nothing else; drop a trailing pipe into a reader that exits. A command with no recognisable server
 * segment is kept exactly as it was — never guessed. PURE.
 */
export function serverLaunchCommand(command: string): string {
  const cmd = String(command || '').trim();
  if (!cmd) return '';
  // Newlines and a lone `&` separate commands too: a model backgrounds the server with `… &` and
  // then runs a port probe on the next line (build 75ea6136 stored both as one recipe).
  const segments = cmd.split(/\s*(?:&&|;|\n|(?<![&>|])&(?!&))\s*/).map((x) => x.trim()).filter(Boolean);
  // A one-shot segment is never the server, whatever words it carries — `(git commit -q -m "edit
  // vite.config.ts" || true)` names Vite in its MESSAGE (autopsy 2b1f845e). Same predicate the
  // launcher uses, so the two cannot disagree about which segment started the app.
  const serverAt = segments.findIndex((seg) => !isOneShotSegment(seg) && SERVER_SEGMENT.test(seg.replace(TRUNCATING_PIPE, '')));
  if (serverAt < 0) return cmd;
  const setup = segments.slice(0, serverAt).filter((seg) => SETUP_SEGMENT.test(seg));
  const server = segments[serverAt].replace(TRUNCATING_PIPE, '').replace(/\s*2>&1\s*$/, '').trim();
  return [...setup, server].join(' && ');
}

/**
 * True when the launcher itself would treat `command` as starting a server. PURE.
 *
 * Asked of the SAME classifier the actuator used to route the command into the managed boot
 * (`isLongRunningCommand`), never a second regex — two answers to "is this a launch?" are how a git
 * commit became a recipe.
 */
export function startsAServer(command: string): boolean {
  return isLongRunningCommand(command);
}

/** Record a dev-server launch that was observed to come up. Never throws. */
export function recordDevServerLaunch(workspaceId: string, command: string, port: number, now = Date.now()): void {
  const cmd = serverLaunchCommand(command);
  if (!workspaceId || !cmd) return;
  // A command in which no segment starts a server is not a launch, whatever port happened to answer
  // after it — recording it would make the revival recipe replay a git commit (autopsy 2b1f845e).
  if (!startsAServer(cmd)) return;
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) return;
  launches.set(workspaceId, { command: cmd, port, at: now });
  // Bounded: a long-lived instance must not accumulate a map entry per workspace it ever served.
  if (launches.size > 500) {
    for (const [id, l] of launches) {
      if (now - l.at > LAUNCH_TTL_MS) launches.delete(id);
    }
  }
}

/** The last observed-up launch for this workspace, or null when there is none / it is stale. */
export function lastDevServerLaunch(workspaceId: string, now = Date.now()): DevServerLaunch | null {
  const l = workspaceId ? launches.get(workspaceId) : undefined;
  if (!l) return null;
  if (now - l.at > LAUNCH_TTL_MS) {
    launches.delete(workspaceId);
    return null;
  }
  return l;
}

/** Test-only reset so one test's state cannot leak into the next. */
export function __resetDevServerLaunchLog(): void {
  launches.clear();
}
