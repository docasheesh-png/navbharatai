/**
 * THE PUBLISH GATE — what may leave a user's workspace and become public source code.
 *
 * ROADMAP §2 (community gallery / remix). This module is the reason that feature is safe to have.
 *
 * 🔒 WHAT IS ACTUALLY AT STAKE. Every other publish path in this codebase ships an ARTEFACT — a
 * rendered HTML snapshot (share portal) or a signed APK (Nav App Store). This one ships SOURCE, and a
 * generated app's source sits next to the user's `.env`, their Supabase keys, their payment
 * credentials. Publishing that is not a bug with a bad error message; it is handing a stranger the
 * user's live database. People do this to themselves on public GitHub every day. So the gate is the
 * feature, and the browsing UI is the easy part.
 *
 * 🔒 IT REUSES THE EXISTING DETECTORS, DELIBERATELY. `scanSecurity` (hardcoded credentials, private
 * keys, AWS ids) and `scanEnvTemplateSecrets` (a real value in a committed `.env.example`) already
 * exist and are already tuned — including the fixture/placeholder suppression that stops a demo
 * password being treated as a leak. A fourth private copy of "what does a secret look like" would
 * drift from those three within a month, and the copy guarding the PUBLIC door is the worst one to let
 * drift. This module contributes the publish DECISION, not new pattern-matching.
 *
 * TWO SEPARATE MECHANISMS, because they answer different questions:
 *   • EXCLUDED — files that simply never travel (`.env`, `node_modules`, build output, lockfiles). No
 *     judgement needed and nothing is lost: a remix regenerates them.
 *   • BLOCKED — a real secret found inside a file that WOULD have travelled. Publication is refused
 *     outright and the file and line are named, because silently stripping it would leave the user
 *     believing they published something they did not.
 */

import { scanSecurity, isEnvSecretsFile, isFixtureFile } from '../AgentV3/SecurityAnalysis';
import { scanEnvTemplateSecrets, isEnvTemplateFile } from '../AgentV3/EnvSecretValueAnalysis';

/**
 * Total published source cap. Chosen from what a generated app actually is once lockfiles and build
 * output are excluded (tens of KB), with headroom — and it keeps a published bundle inside one
 * Firestore document, so the gallery needs no new storage infrastructure to exist.
 */
export const MAX_PUBLISH_BYTES = 700_000;
export const MAX_PUBLISH_FILES = 400;

/** Never published. Each either carries secrets, is regenerable, or is not the user's source. */
const EXCLUDED_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.git|\.turbo|\.vercel)\//;
const EXCLUDED_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|\.DS_Store)$/;
/** Binary-ish or oversized-by-nature; a gallery entry is source, not assets. */
const EXCLUDED_EXT = /\.(png|jpe?g|gif|webp|avif|ico|mp4|mov|mp3|wav|zip|gz|tar|pdf|woff2?|ttf|eot|otf)$/i;

export type ExclusionReason = 'secrets-file' | 'dependency' | 'generated' | 'binary' | 'too-large';

export interface ExcludedFile {
  path: string;
  reason: ExclusionReason;
}

export interface PublishBlocker {
  path: string;
  line: number;
  /** What was found, in words the person publishing can act on. */
  message: string;
}

export type PublishBundle =
  | { ok: true; files: Record<string, string>; excluded: ExcludedFile[]; bytes: number }
  | { ok: false; blockers: PublishBlocker[]; excluded: ExcludedFile[]; message: string };

/** Why this path never travels — or null when it may. */
export function exclusionFor(path: string): ExclusionReason | null {
  if (isEnvSecretsFile(path)) return 'secrets-file';
  if (EXCLUDED_DIR.test(path)) return 'dependency';
  if (EXCLUDED_FILE.test(path)) return 'generated';
  if (EXCLUDED_EXT.test(path)) return 'binary';
  return null;
}

/**
 * Real secrets inside a file that would otherwise be published.
 *
 * Only HIGH-severity findings block. That is not leniency: `scanSecurity` already downgrades
 * credential-shaped strings inside obvious fixture/mock files, precisely so a demo login does not get
 * treated as a live key — and a gate that refuses to publish every demo app would simply be turned
 * off. A private key, an AWS id or a real hardcoded token stays high everywhere, and those are what
 * this stops.
 */
export function findPublishBlockers(files: Record<string, string>): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  for (const [path, content] of Object.entries(files ?? {})) {
    if (typeof content !== 'string') continue;
    if (exclusionFor(path)) continue;                 // it is not travelling; nothing to block

    for (const f of scanSecurity(path, content)) {
      if (f.severity !== 'high') continue;
      blockers.push({
        path,
        line: f.line,
        message: `${f.message} Remove it (or move it to an environment variable) before publishing.`,
      });
    }

    // A committed `.env.example` DOES travel — it is a template, and templates are useful to a
    // remixer. But a real value left inside one is the classic way a key reaches a public repo.
    if (isEnvTemplateFile(path)) {
      for (const issue of scanEnvTemplateSecrets(path, content)) {
        blockers.push({
          path,
          line: issue.line,
          message: `${path} has a real ${issue.kind} in ${issue.key}. A published template must hold placeholders only.`,
        });
      }
    }
  }
  return blockers;
}

/**
 * Decide what — if anything — may be published.
 *
 * Returns the exact file set to store, or a refusal naming every blocker. It never returns a
 * partially-scrubbed bundle alongside `ok: true`: a user who is told "published" must have published
 * what they think they did.
 */
export function preparePublishBundle(files: Record<string, string>): PublishBundle {
  const source = files ?? {};
  const excluded: ExcludedFile[] = [];
  const kept: Record<string, string> = {};
  let bytes = 0;

  for (const path of Object.keys(source).sort()) {
    const content = source[path];
    if (typeof content !== 'string') continue;
    const reason = exclusionFor(path);
    if (reason) { excluded.push({ path, reason }); continue; }
    // A single enormous file is almost always generated or vendored, and it would eat the whole cap.
    if (content.length > 200_000) { excluded.push({ path, reason: 'too-large' }); continue; }
    kept[path] = content;
    bytes += content.length;
  }

  const blockers = findPublishBlockers(source);
  if (blockers.length > 0) {
    return {
      ok: false,
      blockers,
      excluded,
      message: blockers.length === 1
        ? `Cannot publish: a secret is still in your code (${blockers[0].path}, line ${blockers[0].line}).`
        : `Cannot publish: ${blockers.length} secrets are still in your code. Remove them and try again.`,
    };
  }

  const keptCount = Object.keys(kept).length;
  if (keptCount === 0) {
    return { ok: false, blockers: [], excluded, message: 'There is no source code to publish yet — build an app first.' };
  }
  if (keptCount > MAX_PUBLISH_FILES) {
    return { ok: false, blockers: [], excluded, message: `This app has ${keptCount} files; the gallery accepts up to ${MAX_PUBLISH_FILES}.` };
  }
  if (bytes > MAX_PUBLISH_BYTES) {
    return {
      ok: false,
      blockers: [],
      excluded,
      message: `This app's source is ${Math.round(bytes / 1024)} KB; the gallery accepts up to ${Math.round(MAX_PUBLISH_BYTES / 1024)} KB.`,
    };
  }

  return { ok: true, files: kept, excluded, bytes };
}

/** A one-line, honest summary of what was left out, for the confirmation screen. */
export function exclusionSummary(excluded: ExcludedFile[]): string {
  if (excluded.length === 0) return 'Everything in your project will be published.';
  const secrets = excluded.filter((e) => e.reason === 'secrets-file').length;
  const parts: string[] = [];
  if (secrets > 0) parts.push(`${secrets} environment file${secrets === 1 ? '' : 's'} (your keys stay private)`);
  const rest = excluded.length - secrets;
  if (rest > 0) parts.push(`${rest} generated or binary file${rest === 1 ? '' : 's'}`);
  return `Not published: ${parts.join(', ')}.`;
}

/** Re-exported so a caller can explain why a demo credential did not block. */
export { isFixtureFile };
