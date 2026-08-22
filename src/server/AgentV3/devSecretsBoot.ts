// THE APP'S OWN KEYS, PRESENT AT EVERY BOOT — one implementation, every path that starts a server.
//
// 🔒 ROOT CAUSE (admin, 2026-08-22: "live preview ek baar chal jata hai, phir browser band karke wapas
// chalao to nahi chalta, chahe kuch kar lo").
//
// A live `.env` is deliberately never imported and never persisted durably — the user's secrets stay
// theirs. That is correct, and it has a consequence nobody had followed through: the `.env` exists
// ONLY inside the sandbox that wrote it. So the moment a sandbox is recycled, the app comes back with
// its files and WITHOUT its keys.
//
// The build path wrote one. The WAKE path — `/api/agentv3/preview-diagnose`, which is what the "Wake
// up" button and the auto-restore both call — wrote NO `.env` at all: not the user's vault keys, not
// the self-issued ones. It resumed the sandbox, re-hydrated the files, ran `npm run dev`… into an app
// with no `SESSION_SECRET`. express-session throws on boot, or every request 500s. Pressing Wake
// again did exactly the same thing again, which is precisely the "chahe kuch kar lo" the admin
// described.
//
// So this lives in ONE module that both the dispatcher and the wake route call. Two copies of "write
// the dev .env" is the drift that caused this: one path learned to conjure secrets in July and the
// other never did.

import { mergeDotEnv, gitignoreWithEnv } from '../secrets/appSecretsEnv';
import { envNamesFromGrep, conjureMissingLocalSecrets } from './ImportPreview';

/** The tiny slice of an actuator this needs — so it is testable with a plain fake. */
export interface BootEnvIo {
  readFile(workspaceId: string, path: string): Promise<string>;
  writeFile(workspaceId: string, path: string, content: string): Promise<void>;
  runCommand(workspaceId: string, command: string): Promise<{ stdout: string }>;
}

export interface BootEnvResult {
  /** Vault keys written into `.env`. */
  vault: string[];
  /** Self-issued secrets that had to be generated because the app had none. */
  conjured: string[];
  /** True when `.env` was actually written. */
  wrote: boolean;
}

/**
 * One grep for every env name the app's own code reads. Bounded, deterministic, no model call.
 *
 * Reading the sandbox rather than the durable file map is deliberate: this runs immediately before a
 * dev server starts, where loading every file to scan it would cost more than the boot it protects —
 * and the sandbox is the app as it ACTUALLY is, including anything written moments ago.
 */
export const ENV_SCAN_COMMAND =
  'grep -rhoE "(process|import\\.meta)\\.env\\.[A-Za-z_][A-Za-z0-9_]*" . '
  + '--include=*.js --include=*.ts --include=*.jsx --include=*.tsx --include=*.mjs --include=*.cjs '
  + '--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build 2>/dev/null | sort -u | head -200';

/**
 * Make sure the app has, on disk, every key it needs to BOOT — before anything tries to start it.
 *
 * Order matters and is the whole safety story:
 *   1. Whatever the `.env` already holds is kept.
 *   2. The user's vault keys are merged in — a real key the user saved always beats anything we make.
 *   3. Only then are the app's SELF-ISSUED secrets (session/JWT/cookie/CSRF signing) generated, and
 *      only for names still missing or empty. A third-party credential is NEVER invented: a fake
 *      Stripe key makes the app fire real requests with garbage and fail confusingly, while an absent
 *      one leaves that one feature cleanly inactive.
 *
 * Never throws. A failure here leaves the app exactly as it would have been, so this can only help.
 */
export async function ensureBootEnv(
  io: BootEnvIo,
  workspaceId: string,
  vaultSecrets: Record<string, string> = {},
): Promise<BootEnvResult> {
  const result: BootEnvResult = { vault: [], conjured: [], wrote: false };
  try {
    let existing = '';
    try { existing = await io.readFile(workspaceId, '.env'); } catch { existing = ''; }

    let content = existing;
    const vaultNames = Object.keys(vaultSecrets ?? {});
    if (vaultNames.length > 0) {
      content = mergeDotEnv(content, vaultSecrets);
      result.vault = vaultNames;
    }

    let names: string[] = [];
    try {
      const scan = await io.runCommand(workspaceId, ENV_SCAN_COMMAND);
      names = envNamesFromGrep(scan?.stdout ?? '');
    } catch { names = []; }
    if (names.length > 0) {
      const conjured = conjureMissingLocalSecrets(content, names);
      content = conjured.content;
      result.conjured = conjured.added;
    }

    if (content === existing) return result;   // nothing to add — never rewrite a file for no reason
    await io.writeFile(workspaceId, '.env', content);
    result.wrote = true;

    // `.env` now holds real values, so keep it out of git — the same hardening the build path does.
    try {
      let gi = '';
      try { gi = await io.readFile(workspaceId, '.gitignore'); } catch { gi = ''; }
      const nextGi = gitignoreWithEnv(gi);
      if (nextGi !== gi) await io.writeFile(workspaceId, '.gitignore', nextGi);
    } catch { /* gitignore hardening is best-effort */ }
  } catch { /* the app boots as it would have — this path can only ever add keys */ }
  return result;
}

/**
 * The honest one-line note for the wake/diagnose stream. PURE.
 *
 * It names the self-issued generation explicitly rather than hiding it: a user who later wonders why
 * their sessions did not survive a restart deserves to know a development key was minted for the
 * sandbox, not to discover it.
 */
export function bootEnvNote(r: BootEnvResult): string {
  const parts: string[] = [];
  if (r.vault.length > 0) parts.push(`restored ${r.vault.length} of your saved key${r.vault.length === 1 ? '' : 's'}`);
  if (r.conjured.length > 0) parts.push(`generated a development key for ${r.conjured.join(', ')} so the app can start`);
  return parts.length === 0 ? '' : `Preparing your app's environment — ${parts.join('; ')}.`;
}
