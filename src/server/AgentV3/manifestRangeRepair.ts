/**
 * A DECLARED DEPENDENCY RANGE THAT DOES NOT EXIST IS FIXED BY THE PLATFORM, NOT RE-DISCOVERED BY A MODEL
 * (autopsy 4173fb7 / b4173fb7, 2026-10-21).
 *
 * The one-shot lane wrote a `package.json` that declared `@types/react-dropzone@^14.2.7` — a range that has never
 * existed. The platform's own install (`npm install … || npm install … --legacy-peer-deps`) failed with ETARGET,
 * then the "install the 3 missing packages" step re-ran the same install over the same manifest and failed the
 * same way; no `node_modules` ever landed, the production build could not find `framer-motion`, and the release
 * gate counted three build-breaking blockers. `npmVersionHint.ts` already knows how to read npm's ETARGET and
 * ask the registry for the real version — but only to ADVISE a model that issued the install. A manifest-driven
 * install has no model to advise: nobody was going to act on the hint.
 *
 * So the deterministic half lives here. For a bare manifest install that failed with ETARGET:
 *   · a package whose LATEST version is known gets that version as its range (`^<latest>`);
 *   · a package the registry does not know at all is removed from the manifest — nothing can import it;
 * then the install runs once more. A command that NAMES packages (`npm install cors@^4`) is a model's guess and
 * keeps its hint; this module never touches it. PURE — the registry query and the write live at the call site.
 */
import type { MissingRange } from './npmVersionHint';

/** Kill switch `AGENTV3_MANIFEST_RANGE_REPAIR=off`; default on. */
export function manifestRangeRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_MANIFEST_RANGE_REPAIR ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Is this command an install driven by package.json alone — no package named on any `npm install` segment?
 * `npm install --no-audit || npm install --legacy-peer-deps` is; `npm install cors@^4` is not. PURE.
 */
export function isBareManifestInstall(command: string): boolean {
  const segments = String(command ?? '').split(/\|\||&&|;|\|/).map((s) => s.trim()).filter(Boolean);
  let sawInstall = false;
  for (const seg of segments) {
    const m = /^(?:cd\s+\S+\s+&&\s*)?(?:npm|pnpm|yarn)\s+(install|i|ci|add)\b(.*)$/.exec(seg);
    if (!m) continue;
    sawInstall = true;
    if (m[1] === 'add') return false;
    const operands = m[2].trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
    if (operands.length > 0) return false;
  }
  return sawInstall;
}

export interface ManifestRepair {
  /** The repaired package.json text, or null when nothing in it needed (or allowed) a change. */
  text: string | null;
  /** One plain sentence per change, for the tool result. */
  changes: string[];
}

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

/**
 * Apply the repair to a manifest. `latest` maps a package to the version the registry reports ('' or absent =
 * the registry does not know it). Packages not declared in the manifest are ignored. Never throws. PURE.
 */
export function repairUnavailableRanges(
  manifestText: string,
  missing: readonly MissingRange[],
  latest: ReadonlyMap<string, string>,
): ManifestRepair {
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(manifestText ?? ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { text: null, changes: [] };
    manifest = parsed as Record<string, unknown>;
  } catch {
    return { text: null, changes: [] };
  }
  const changes: string[] = [];
  for (const { name, range } of missing) {
    for (const section of SECTIONS) {
      const deps = manifest[section];
      if (!deps || typeof deps !== 'object' || !(name in (deps as Record<string, unknown>))) continue;
      const table = deps as Record<string, string>;
      if (table[name] !== range && !String(table[name]).includes(range)) continue; // npm named a range this entry does not hold
      const real = latest.get(name);
      if (real && /^\d+\.\d+\.\d+/.test(real)) {
        table[name] = `^${real}`;
        changes.push(`${name}@${range} does not exist — set to ^${real}, the version npm has`);
      } else {
        delete table[name];
        changes.push(`${name} is not on npm at all — removed from ${section}`);
      }
    }
  }
  if (changes.length === 0) return { text: null, changes: [] };
  return { text: `${JSON.stringify(manifest, null, 2)}\n`, changes };
}

/** The note appended to the install's output. PURE. */
export function manifestRepairNote(changes: readonly string[], retryOk: boolean): string {
  if (changes.length === 0) return '';
  return `[manifest repaired] package.json declared version(s) that do not exist, so npm could not install anything: ${changes.join('; ')}. `
    + (retryOk ? 'The install was run again and succeeded.' : 'The install was run again and still failed — read the error above.');
}
