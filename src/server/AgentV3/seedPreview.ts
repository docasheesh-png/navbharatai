// THE GAME IS ON SCREEN AS SOON AS THE PLATFORM HAS MOUNTED IT (failedbr #2485, Q-3233).
//
// «TIME_TO_FIRST_RENDER: 1114s from build start to the first real-browser render.» The user watched a spinner for eighteen
// minutes. The preview only ever came up when the BUILDER ran the dev server, or — as on that build — when the platform
// started it itself at the very end, for its own checks. But once the seed has mounted the open-world starter in
// src/App.tsx, the app is a complete, playable game BEFORE the first model call: nothing has to be waited for.
// 🧬 THE CLASS: something the platform already has, held back until a model happens to ask for it. So right after such a
// seed the platform starts the dev server, earns the address (a real HTTP answer, not a guess) and publishes the preview;
// the builder is told it is already running. Kill switch: AGENTV3_SEED_PREVIEW=off.
import { parseDevServerHealthLine } from './sandbox/EngineerAI/actuators/DevServerRecovery';

export function seedPreviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SEED_PREVIEW ?? '').trim().toLowerCase() !== 'off';
}

/** The recipes whose mount makes the app playable as it stands. */
export function seedMountedAPlayableApp(seeded: readonly string[]): boolean {
  return seeded.includes('generate_open_world');
}

export const SEED_PREVIEW_HANDOFF = '🖥️ THE PREVIEW IS ALREADY RUNNING: NavBharatAI started the dev server and the user is looking at the game right now. '
  + 'Do NOT start, restart or kill a dev server and do not call update_preview — every file you write shows up in it by itself.';

type Issue = { phase: 'preview'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };

/** Start the app, earn its address, and say what happened. Never throws; a preview that does not come up changes nothing. */
export async function startPreviewAfterSeed(io: {
  seeded: readonly string[];
  alreadyUp: boolean;
  port: number;
  command?: string;
  run: (command: string) => Promise<{ stdout?: string; stderr?: string }>;
  portUrl: (port: number) => Promise<string>;
  record: (issue: Issue) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<{ url: string; port: number } | null> {
  try {
    if (!seedPreviewEnabled(io.env) || io.alreadyUp || !seedMountedAPlayableApp(io.seeded)) return null;
    const startedAt = Date.now();
    const started = await io.run(io.command ?? 'npm run dev');
    const health = parseDevServerHealthLine(`${started.stdout ?? ''}\n${started.stderr ?? ''}`);
    const port = health?.up && health.port ? health.port : io.port;
    const probe = await io.run(`curl -sL -o /dev/null --max-time 5 -w "__STATUS__%{http_code}" http://127.0.0.1:${port} 2>/dev/null || echo "__STATUS__000"`).catch(() => ({ stdout: '__STATUS__000' }));
    const status = Number(/__STATUS__(\d{3})/.exec(String(probe.stdout ?? ''))?.[1] ?? 0);
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    if (!(status >= 200 && status < 400)) {
      io.record({ phase: 'preview', severity: 'info', code: 'SEED_PREVIEW_NOT_UP', autoResolved: true,
        message: `The platform tried to show the mounted game before the builder started — nothing answered on port ${port} within ${seconds}s (HTTP ${status || 'none'}). The preview comes up later, as before.` });
      return null;
    }
    const url = await io.portUrl(port);
    if (!url) return null;
    io.record({ phase: 'preview', severity: 'info', code: 'SEED_PREVIEW_UP', autoResolved: true,
      message: `The game the platform mounted is on screen ${seconds}s after the kit was laid down, before the builder's first call (port ${port}, HTTP ${status}).` });
    return { url, port };
  } catch { return null; }
}

/**
 * WHERE THE SEED'S TIME WENT, per recipe (failedbr #2485, Q-3232: "recipes 61.5 s" for six recipes, and nothing said which).
 * A number nobody can break down is a number nobody can bring down. PURE.
 */
export function seedRecipeTimes(results: ReadonlyArray<{ recipe: string; ms?: number }>): string {
  return results.filter((r) => typeof r.ms === 'number').map((r) => `${r.recipe.replace(/^generate_/, '')} ${((r.ms as number) / 1000).toFixed(1)} s`).join(', ') || 'not timed';
}
