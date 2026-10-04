// The fast lane and the one-shot lane write whole files from the app description alone. This module is
// the ONE rule for which existing project files they are shown before they rewrite them.

/**
 * 🔴 A CONFIG FILE THE PROJECT ALREADY HAS IS EDITED, NOT REWRITTEN BLIND (autopsy dcce5d26, 2026-10-04).
 *
 * The plan for a two-screen app listed `tsconfig.json`, `tsconfig.build.json`, `tsconfig.node.json`,
 * `package.json` and `vite.config.ts` — every one already in the starter, working — and each per-file call
 * writes its file "in full" from the app description alone, never seeing what was there. That is how a
 * rewrite drops the preview host setting (`ViteConfigGuard` exists to put it back), the entry's root div
 * (`ensureHtmlEntryScript`), the build script, and — silently — the strict-mode cohort's tsconfig, which
 * the strict trial measures. A heal for each, and none for the cause.
 *
 * So a planned file that is one of the project's CONFIG files and already exists is handed its current
 * content, with the instruction to keep it and change only what the app needs. Source files (the starter's
 * `src/App.tsx`) are deliberately not: replacing the starter page IS the job there.
 */
export function isProjectConfigPath(path: string): boolean {
  const p = String(path || '').trim();
  return /^(?:package\.json|index\.html|(?:ts|js)config(?:\.[\w-]+)?\.json|(?:vite|next|tailwind|postcss|svelte|astro|nuxt)\.config\.(?:c|m)?[jt]s)$/i.test(p);
}

/** The largest current content shown to a per-file call; a bigger file is left to today's behaviour. */
export const EXISTING_CONFIG_MAX_CHARS = 6000;

/** The block that hands a per-file call the file it is editing. Empty when there is nothing to show. */
export function existingFileBlock(path: string, existing?: string | null): string {
  const text = typeof existing === 'string' ? existing : '';
  if (!text.trim() || text.length > EXISTING_CONFIG_MAX_CHARS) return '';
  return [
    '',
    `THIS FILE ALREADY EXISTS in the project and works. Its current content:`,
    `<<<CURRENT ${path}>>>`,
    text,
    '<<<END CURRENT>>>',
    'Keep every script, dependency, compiler option, server setting and tag it has unless this app needs it changed; add only what the app needs. Return the WHOLE updated file.',
  ].join('\n');
}


/**
 * The one-shot lane writes the whole app in one answer, and may rewrite any config file with it. Every
 * existing config file is shown together, under the same rule. Empty when there is nothing to show.
 */
export function existingConfigsBlock(existing: Readonly<Record<string, string | null | undefined>>): string {
  const parts = Object.entries(existing)
    .filter(([path, text]) => isProjectConfigPath(path) && typeof text === 'string' && text.trim() && text.length <= EXISTING_CONFIG_MAX_CHARS)
    .map(([path, text]) => `<<<CURRENT ${path}>>>\n${text}\n<<<END CURRENT>>>`);
  if (!parts.length) return '';
  return [
    '',
    'These project files ALREADY EXIST and work. If you output one of them, keep every script, dependency, compiler option, server setting and tag it has unless this app needs it changed, and return the WHOLE updated file. Leave a file out entirely if the app needs no change to it.',
    ...parts,
  ].join('\n');
}
