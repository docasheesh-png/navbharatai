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

/** Record a dev-server launch that was observed to come up. Never throws. */
export function recordDevServerLaunch(workspaceId: string, command: string, port: number, now = Date.now()): void {
  const cmd = String(command || '').trim();
  if (!workspaceId || !cmd) return;
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
