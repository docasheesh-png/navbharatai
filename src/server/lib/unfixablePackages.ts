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
  xlsx: 'no fixed release on npm (SheetJS publishes fixed builds only from cdn.sheetjs.com) — uninstall it (`npm uninstall xlsx`) and use `exceljs` for Excel files instead',
};

/**
 * Packages a built app does not need because the platform already has the thing built in — named at
 * install time so the builder removes them instead of shipping a dependency (and its advisories).
 *
 * 🔴 Autopsy dfd24058 (2026-10-01): a JARVIS web app ran `npm install uuid && npm install --save-dev
 * @types/uuid` to make chat-message ids. It shipped with a moderate advisory (uuid@9.0.1,
 * GHSA-w5hq-g745-h8pq) and a type mismatch (`@types/uuid` v10 over `uuid` v9) — both for a function every
 * browser and Node 19+ has built in. A closed, reviewed list, like the one above. PURE.
 */
export const BUILT_IN_ALTERNATIVES: Readonly<Record<string, string>> = {
  uuid: '`crypto.randomUUID()` is built into every modern browser and Node 19+ — no package needed; uninstall it (`npm uninstall uuid @types/uuid`) and call `crypto.randomUUID()`',
  '@types/uuid': '`uuid` ships its own types since v10, and `crypto.randomUUID()` needs none — uninstall it',
};

/** Advice for one package, or null. PURE. */
export function unfixablePackageAdvice(name: string): string | null {
  return UNFIXABLE_NPM_PACKAGES[String(name ?? '').trim().toLowerCase()] ?? null;
}

/**
 * The packages an `npm install` / `pnpm add` / `yarn add` command asks for. PURE.
 *
 * 🔴 A WORD AFTER A PIPE IS NOT A PACKAGE (found by Q-1084's own test, 2026-10-14). The segment splitter
 * breaks on `&&`, `||`, `;` and newlines but NOT on a single `|`, so everything after a pipe was still read
 * as package names: the reported build's first command,
 * `npm install @ffmpeg/ffmpeg @ffmpeg/util 2>&1 | tail -20`, parsed as THREE packages — the two real ones
 * and `tail`.
 *
 * ⚠️ AND THAT IS NOT COSMETIC, WHICH IS WHY IT IS FIXED HERE RATHER THAN NOTED. `bannedInstallRefusal`
 * REFUSES TO RUN an install naming a listed package, so one shell word after a pipe that happens to match a
 * list would block a legitimate install outright — `npm install react 2>&1 | grep uuid` would be refused for
 * `uuid`. Piping an install into `tail`/`head`/`grep` is exactly what this builder does by habit.
 *
 * So a redirect or pipe token ENDS the package list for that segment, where before it was merely skipped.
 * Flags are still skipped, not terminal, so `npm i -D @types/x y` is unchanged.
 */
export function packagesInstalledBy(command: string): string[] {
  const out: string[] = [];
  for (const seg of String(command ?? '').split(/&&|\|\||;|\n/)) {
    const m = seg.match(/\b(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|i|install)|yarn\s+add|bun\s+add)\b(.*)$/);
    if (!m) continue;
    for (const w of m[1].split(/\s+/)) {
      if (!w) continue;
      if (/[<>|&]/.test(w)) break; // ← everything after a redirect or pipe belongs to another command
      if (w.startsWith('-')) continue;
      const name = w.startsWith('@') ? w.split('@').slice(0, 2).join('@') : w.split('@')[0];
      if (name) out.push(name);
    }
  }
  return out;
}

/** The note the bash tool appends when a command installs one of these. '' when none. PURE. */
export function unfixableInstallNote(command: string): string {
  const installed = packagesInstalledBy(command);
  const lines = [
    ...installed.filter((p) => unfixablePackageAdvice(p)).map((p) => `⚠️ \`${p}\`: ${unfixablePackageAdvice(p)}.`),
    ...installed.filter((p) => BUILT_IN_ALTERNATIVES[p.toLowerCase()]).map((p) => `💡 \`${p}\`: ${BUILT_IN_ALTERNATIVES[p.toLowerCase()]}.`),
  ];
  return lines.join('\n');
}

/**
 * PACKAGES WHOSE RUNTIME NEEDS A SECOND ARTIFACT THE INSTALLER DOES NOT PULL — and the wiring that makes
 * them work. Q-1084.
 *
 * 🔴 WHY, AND THE EVIDENCE IS UNUSUALLY COMPLETE (build `413d29a1`, 2026-10-14 — an MP4→MP3 converter).
 * The app shipped with its own screen reading *"Failed to load converter engine: Error: failed to import
 * ffmpeg-core.js"*, and the release gate went RED. `npm install @ffmpeg/ffmpeg @ffmpeg/util` succeeded,
 * `found 0 vulnerabilities` — a clean install of a package that still cannot run, because
 * `@ffmpeg/ffmpeg` fetches its WebAssembly core at RUNTIME and npm pulls no such thing.
 *
 * ⚠️ AND THE BUILDER WAS NOT IGNORANT — IT KNEW EVERYTHING, WHICH IS WHY THIS LIST IS A PROMPT RULE AND
 * NOT ANOTHER WARNING. Reading its own commands from that report, after the error it proved the diagnosis
 * completely: `cat node_modules/@ffmpeg/core/package.json … || echo "no @ffmpeg/core installed"` →
 * *"no @ffmpeg/core installed"*; it fetched the CDN build and got `200` with
 * `access-control-allow-origin: *`; it read `classes.js`, `worker.js`, `const.js` and `errors.js` to find
 * where the import happens. About thirty commands of correct investigation — and the fix was never
 * applied, because that turn was then consumed by the no-op loop of Q-1081.
 *
 * So a note AFTER the install would have told it what it had already worked out for itself. The only thing
 * that would have helped is knowing BEFORE the first line of code was written — which is exactly what
 * autopsy 3f959fde concluded one function below: *"Advice about a package the project already depends on
 * reads as a caveat. Told BEFORE the first install, it is a choice."* The 50/50 law's prevent half: with
 * this, the error never happens, so the thirty commands and the loop never happen either.
 *
 * A closed, reviewed list, like the two above — never a guess about a package. Each entry states the shape
 * of what is required, not a pinned version, so it cannot go stale into a lie. PURE.
 */
export const NEEDS_RUNTIME_ARTIFACT: Readonly<Record<string, string>> = {
  '@ffmpeg/ffmpeg': 'installs the wrapper only — its WebAssembly core is fetched at RUNTIME and npm pulls none, '
    + 'so `ffmpeg.load()` with no arguments fails with "failed to import ffmpeg-core.js" and the app paints that error. '
    + 'Pass the core explicitly: `await ffmpeg.load({ coreURL, wasmURL })`, building each with `toBlobURL()` from '
    + '`@ffmpeg/util` (a blob URL is what lets the worker load a cross-origin file at all) and pointing at a matching '
    + '`@ffmpeg/core` build — either `npm install @ffmpeg/core` and serve it from the app, or a CDN copy of the same '
    + 'version. Use the single-threaded core unless you have set COOP/COEP headers: the `-mt` build needs '
    + 'SharedArrayBuffer and will fail without cross-origin isolation',
};

/** What a package needs wired before it can run, or null. PURE. */
export function runtimeArtifactAdvice(name: string): string | null {
  return NEEDS_RUNTIME_ARTIFACT[String(name ?? '').trim().toLowerCase()] ?? null;
}

/**
 * 🔴 THE NOTE CAME AFTER THE INSTALL, AND THE INSTALL STAYED (autopsy 3f959fde, 2026-10-01). The note above
 * fired when `npm install xlsx` ran; the builder read it, wrote "warn about xlsx advisory? Maybe not", and
 * shipped xlsx with its HIGH advisory. Advice about a package the project already depends on reads as a
 * caveat. Told BEFORE the first install, it is a choice. Derived from the two lists above, so a package
 * added to either reaches every prompt that carries this rule. PURE.
 */
export function packageChoiceRule(): string {
  const lines = [
    ...Object.entries(UNFIXABLE_NPM_PACKAGES).map(([p, why]) => `- \`${p}\`: ${why.replace(/ — uninstall it \(`[^`]*`\) and /, ' — ')}.`),
    ...Object.entries(BUILT_IN_ALTERNATIVES).map(([p, why]) => `- \`${p}\`: ${why.replace(/; uninstall it \(`[^`]*`\) and /, '; ').replace(/ — uninstall it$/, '')}.`),
  ];
  const wiring = Object.entries(NEEDS_RUNTIME_ARTIFACT).map(([p, why]) => `- \`${p}\` ${why}.`);
  // Derived from the lists, never a second hand-written copy: an entry added above reaches every prompt that
  // carries this rule, which is the whole reason 3f959fde moved this advice to BEFORE the install.
  return `PACKAGES NOT TO INSTALL (they ship known, unfixed advisories, or the platform already has them built in):\n${lines.join('\n')}`
    + `\n\nPACKAGES THAT NEED WIRING BEFORE THEY RUN — a clean \`npm install\` is NOT enough for these, and getting it`
    + ` wrong paints an error on the user's own screen:\n${wiring.join('\n')}`;
}
