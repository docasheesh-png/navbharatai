// A GUESSED VERSION RANGE THAT DOES NOT EXIST — answered with the real one in the same tool result.
//
// 🔴 WHY (autopsy 2b1f845e, 2026-10-01). The model ran `npm install … cors@^4 …` and npm answered
// `ETARGET — No matching version found for cors@^4` (cors has never had a 4.x). The model then had to
// guess again; it guessed right on the next call, which is luck, not design — an install that names
// three packages with invented majors can take three rounds to converge. npm knows the answer and
// one `npm view` returns it, so the tool result carries it: the package, the range that does not
// exist, and the real latest version. Advice only — nothing is installed for the model. PURE parts here.

/** One package whose requested range does not exist. */
export interface MissingRange {
  name: string;
  range: string;
}

const ETARGET_LINE = /No matching version found for ((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@([^\s.]+(?:\.[^\s.]+)*)\.?\s*$/gim;

/** The packages npm said have no matching version, at most `max`, de-duplicated. PURE. */
export function missingRanges(output: string, max = 3): MissingRange[] {
  const out: MissingRange[] = [];
  const text = String(output ?? '');
  if (!/ETARGET|No matching version found/i.test(text)) return out;
  for (const m of text.matchAll(ETARGET_LINE)) {
    const name = m[1];
    const range = m[2].replace(/\.$/, '');
    if (!out.some((x) => x.name === name)) out.push({ name, range });
    if (out.length >= max) break;
  }
  return out;
}

/** A package name that is safe to put on a shell line unquoted (npm's own naming rules). PURE. */
export function isSafePackageName(name: string): boolean {
  return /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name) && name.length <= 214;
}

/** One command that prints `name=<latest>` for each package (blank when npm cannot say). PURE. */
export function latestVersionsCommand(missing: readonly MissingRange[]): string | null {
  const names = missing.map((m) => m.name).filter(isSafePackageName);
  if (names.length === 0) return null;
  return `for p in ${names.join(' ')}; do echo "NBAI_LATEST $p=$(npm view "$p" version 2>/dev/null)"; done`;
}

/** The note for the tool result, or null when npm gave no usable answer. PURE. */
export function versionHint(missing: readonly MissingRange[], viewStdout: string): string | null {
  const latest = new Map<string, string>();
  for (const m of String(viewStdout ?? '').matchAll(/^NBAI_LATEST ((?:@[\w.-]+\/)?[\w.-]+)=(\d+\.\d+\.\d+[\w.-]*)\s*$/gm)) latest.set(m[1], m[2]);
  const lines = missing
    .filter((m) => latest.has(m.name))
    .map((m) => {
      const v = latest.get(m.name) as string;
      return `${m.name}@${m.range} does not exist — the latest ${m.name} is ${v}; use ${m.name}@^${v.split('.')[0]}`;
    });
  if (lines.length === 0) return null;
  return `[version hint] ${lines.join(' · ')}. Re-run the install with these ranges.`;
}
