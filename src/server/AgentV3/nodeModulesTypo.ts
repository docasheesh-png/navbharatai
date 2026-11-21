// `.node_modules/.bin/vite` IS A TYPO, NEVER A FOLDER (autopsy bee95692, 2026-09-30).
//
// A social-media build typed `.node_modules/.bin/vite` four times and `.node_modules/.bin/tsc` twice. No
// project has a `.node_modules` directory, so every run died with "No such file or directory" — and the
// dev-server wrapper then restarted each launch twice (72 s a time), ~5 minutes of a 14.5-minute build.
// The correction is certain, so it is made rather than explained. Only a path that STARTS with
// `.node_modules/` (at the start of the command or after a separator) is touched; `./node_modules`,
// `../node_modules` and any word that merely contains the text are left exactly as written. PURE.

const TYPO = /(^|[\s;&|(`'"])\.node_modules\//g;

// 🔴 …AND `. ./node_modules/.bin/tsc` IS THE SAME TYPO WITH A SPACE (failedbr #1617, 2026-11-20). A build ran
// `. ./node_modules/.bin/tsc --noEmit` seven times. `.` (and `source`) runs a file AS SHELL in the current shell, so
// bash read tsc's JavaScript line by line, and its `import …` lines ran ImageMagick's `import` ("unable to open X
// server") — never the compiler. Sourcing a package binary is never what was meant; it is rewritten to run it.
const SOURCED_BIN = /(^|[;&|(`]\s*|&&\s*|\|\|\s*)(?:\.|source)\s+((?:\.\/)?node_modules\/\.bin\/)/g;

export function fixNodeModulesTypo(command: string): { command: string; fixed: boolean } {
  const raw = String(command ?? '');
  const out = raw.replace(TYPO, '$1./node_modules/').replace(SOURCED_BIN, '$1./node_modules/.bin/');
  return { command: out, fixed: out !== raw };
}
