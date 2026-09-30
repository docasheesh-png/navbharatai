/**
 * npm PACKAGES WITH KNOWN ADVISORIES AND NO FIXED RELEASE ON npm — and what to use instead.
 *
 * 🔴 WHY (autopsy 8e124182, 2026-09-30). A stock app's Excel export installed `xlsx@0.18.5`: one HIGH
 * advisory (prototype pollution) and a ReDoS, and `npm audit` itself says *"No fix available"* — SheetJS
 * stopped publishing to npm at 0.18.5 and ships fixed builds only from its own CDN. The build then told
 * the user to "Upgrade each to a patched version", which for this package does not exist. The honest
 * report names the replacement; the better fix is that the builder hears it when it installs the package.
 *
 * A closed, reviewed list — never a guess about a package. PURE.
 */
export const UNFIXABLE_NPM_PACKAGES: Readonly<Record<string, string>> = {
  xlsx: 'no fixed release on npm (SheetJS publishes fixed builds only from cdn.sheetjs.com) — use `exceljs` for Excel files instead',
};

/** Advice for one package, or null. PURE. */
export function unfixablePackageAdvice(name: string): string | null {
  return UNFIXABLE_NPM_PACKAGES[String(name ?? '').trim().toLowerCase()] ?? null;
}

/** The packages an `npm install` / `pnpm add` / `yarn add` command asks for. PURE. */
export function packagesInstalledBy(command: string): string[] {
  const out: string[] = [];
  for (const seg of String(command ?? '').split(/&&|\|\||;|\n/)) {
    const m = seg.match(/\b(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|i|install)|yarn\s+add|bun\s+add)\b(.*)$/);
    if (!m) continue;
    for (const w of m[1].split(/\s+/)) {
      if (!w || w.startsWith('-') || /[<>|&]/.test(w)) continue;
      const name = w.startsWith('@') ? w.split('@').slice(0, 2).join('@') : w.split('@')[0];
      if (name) out.push(name);
    }
  }
  return out;
}

/** The note the bash tool appends when a command installs one of these. '' when none. PURE. */
export function unfixableInstallNote(command: string): string {
  const hits = packagesInstalledBy(command).filter((p) => unfixablePackageAdvice(p));
  if (hits.length === 0) return '';
  return hits.map((p) => `⚠️ \`${p}\`: ${unfixablePackageAdvice(p)}.`).join('\n');
}
